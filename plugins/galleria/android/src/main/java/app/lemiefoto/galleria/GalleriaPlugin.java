package app.lemiefoto.galleria;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Size;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Collega l'app alla galleria Android:
 * elenco foto, miniature, spostamento nel cestino (Android 11+), copia in album (Immagini/Classificate/Nome).
 */
@CapacitorPlugin(name = "Galleria")
public class GalleriaPlugin extends Plugin {

    private static final String ALBUM_ROOT = Environment.DIRECTORY_PICTURES + "/Classificate/";
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private ActivityResultLauncher<String[]> permLauncher;
    private ActivityResultLauncher<IntentSenderRequest> senderLauncher;
    private PluginCall permCall, trashCall;

    @Override
    public void load() {
        permLauncher = bridge.registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), this::onPermResult);
        senderLauncher = bridge.registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onTrashResult);
    }

    // ---------- Permessi ----------
    private String[] neededPermissions() {
        if (Build.VERSION.SDK_INT >= 34) return new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED };
        if (Build.VERSION.SDK_INT >= 33) return new String[] { Manifest.permission.READ_MEDIA_IMAGES };
        return new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    private boolean has(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject accessState() {
        JSObject r = new JSObject();
        boolean full = Build.VERSION.SDK_INT >= 33 ? has(Manifest.permission.READ_MEDIA_IMAGES) : has(Manifest.permission.READ_EXTERNAL_STORAGE);
        boolean partial = !full && Build.VERSION.SDK_INT >= 34 && has(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        r.put("granted", full || partial);
        r.put("limited", partial);
        return r;
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        JSObject st = accessState();
        if (st.getBool("granted") && !st.getBool("limited")) {
            call.resolve(st);
            return;
        }
        permCall = call;
        permLauncher.launch(neededPermissions());
    }

    private void onPermResult(Map<String, Boolean> result) {
        if (permCall == null) return;
        permCall.resolve(accessState());
        permCall = null;
    }

    // ---------- Elenco foto ----------
    @PluginMethod
    public void listPhotos(PluginCall call) {
        final long fromMs = call.getLong("fromMs", 0L);
        pool.execute(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                String[] proj = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.WIDTH,
                    MediaStore.Images.Media.HEIGHT,
                    MediaStore.Images.Media.SIZE,
                    MediaStore.Images.Media.ORIENTATION
                };
                // Escludo le copie create dall'app (Immagini/Classificate), altrimenti risulterebbero "doppioni".
                StringBuilder sel = new StringBuilder("(" + MediaStore.Images.Media.RELATIVE_PATH + " IS NULL OR " + MediaStore.Images.Media.RELATIVE_PATH + " NOT LIKE ?)");
                List<String> args = new ArrayList<>();
                args.add(ALBUM_ROOT + "%");
                if (fromMs > 0) {
                    sel.append(" AND (" + MediaStore.Images.Media.DATE_TAKEN + " >= ? OR (" + MediaStore.Images.Media.DATE_TAKEN + " IS NULL AND " + MediaStore.Images.Media.DATE_ADDED + " >= ?))");
                    args.add(String.valueOf(fromMs));
                    args.add(String.valueOf(fromMs / 1000));
                }
                JSArray out = new JSArray();
                try (Cursor c = cr.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj, sel.toString(), args.toArray(new String[0]), MediaStore.Images.Media.DATE_TAKEN + " ASC")) {
                    if (c != null) {
                        while (c.moveToNext()) {
                            long id = c.getLong(0);
                            long taken = c.isNull(2) ? c.getLong(3) * 1000L : c.getLong(2);
                            int w = c.getInt(4), h = c.getInt(5), o = c.getInt(7);
                            if (o == 90 || o == 270) { int t = w; w = h; h = t; }
                            JSObject p = new JSObject();
                            p.put("id", String.valueOf(id));
                            p.put("name", c.getString(1));
                            p.put("date", taken);
                            p.put("width", w);
                            p.put("height", h);
                            p.put("size", c.getLong(6));
                            out.put(p);
                        }
                    }
                }
                JSObject r = new JSObject();
                r.put("photos", out);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Non riesco a leggere la galleria: " + e.getMessage(), e);
            }
        });
    }

    private Uri uriFor(String id) {
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
    }

    private File cacheDir() {
        File d = new File(getContext().getCacheDir(), "galleria");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    // ---------- Immagine ridimensionata ----------
    @PluginMethod
    public void getImage(PluginCall call) {
        final String id = call.getString("id");
        final int maxSize = call.getInt("maxSize", 1280);
        final int quality = call.getInt("quality", 85);
        if (id == null) { call.reject("id mancante"); return; }
        pool.execute(() -> {
            try {
                File f = new File(cacheDir(), id + "_" + maxSize + ".jpg");
                if (!f.exists()) {
                    Uri uri = uriFor(id);
                    Bitmap bmp;
                    if (maxSize <= 512) {
                        bmp = getContext().getContentResolver().loadThumbnail(uri, new Size(maxSize, maxSize), null);
                    } else {
                        ImageDecoder.Source src = ImageDecoder.createSource(getContext().getContentResolver(), uri);
                        bmp = ImageDecoder.decodeBitmap(src, (decoder, info, s) -> {
                            int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                            float k = Math.min(1f, (float) maxSize / Math.max(w, h));
                            decoder.setTargetSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
                            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                        });
                    }
                    try (OutputStream os = new FileOutputStream(f)) {
                        bmp.compress(Bitmap.CompressFormat.JPEG, quality, os);
                    }
                    bmp.recycle();
                }
                JSObject r = new JSObject();
                r.put("path", f.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Foto non leggibile: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        File[] files = cacheDir().listFiles();
        if (files != null) for (File f : files) f.delete();
        call.resolve();
    }

    // ---------- Cestino ----------
    @PluginMethod
    public void trash(PluginCall call) {
        try {
            List<String> ids = call.getArray("ids").toList();
            List<Uri> uris = new ArrayList<>();
            for (String id : ids) uris.add(uriFor(id));
            if (uris.isEmpty()) { JSObject r = new JSObject(); r.put("deleted", true); call.resolve(r); return; }
            PendingIntent pi = MediaStore.createTrashRequest(getContext().getContentResolver(), uris, true);
            trashCall = call;
            senderLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
        } catch (Exception e) {
            call.reject("Non riesco a spostare le foto nel cestino: " + e.getMessage(), e);
        }
    }

    private void onTrashResult(ActivityResult result) {
        if (trashCall == null) return;
        JSObject r = new JSObject();
        r.put("deleted", result.getResultCode() == Activity.RESULT_OK);
        trashCall.resolve(r);
        trashCall = null;
    }

    // ---------- Album (copia in Immagini/Classificate/Nome) ----------
    @PluginMethod
    public void addToAlbum(PluginCall call) {
        final String album = call.getString("album", "Senza nome");
        final List<String> ids;
        try { ids = call.getArray("ids").toList(); } catch (Exception e) { call.reject("ids mancanti"); return; }
        pool.execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            String rel = ALBUM_ROOT + album + "/";
            int added = 0;
            for (String id : ids) {
                Uri src = uriFor(id);
                String name = null, mime = "image/jpeg";
                long taken = 0;
                try (Cursor c = cr.query(src, new String[] { MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.DATE_TAKEN }, null, null, null)) {
                    if (c != null && c.moveToFirst()) { name = c.getString(0); if (c.getString(1) != null) mime = c.getString(1); taken = c.getLong(2); }
                } catch (Exception ignored) {}
                if (name == null) name = "foto_" + id + ".jpg";
                if (exists(cr, rel, name)) continue; // già copiata
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH, rel);
                if (taken > 0) v.put(MediaStore.Images.Media.DATE_TAKEN, taken);
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri dst = null;
                try {
                    dst = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (dst == null) continue;
                    try (InputStream in = cr.openInputStream(src); OutputStream out = cr.openOutputStream(dst)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    cr.update(dst, done, null, null);
                    added++;
                } catch (Exception e) {
                    if (dst != null) try { cr.delete(dst, null, null); } catch (Exception ignored) {}
                }
            }
            JSObject r = new JSObject();
            r.put("added", added);
            call.resolve(r);
        });
    }

    private boolean exists(ContentResolver cr, String rel, String name) {
        try (Cursor c = cr.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new String[] { MediaStore.Images.Media._ID },
                MediaStore.Images.Media.RELATIVE_PATH + "=? AND " + MediaStore.Images.Media.DISPLAY_NAME + "=?", new String[] { rel, name }, null)) {
            return c != null && c.getCount() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------- Schermo acceso durante l'analisi ----------
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
