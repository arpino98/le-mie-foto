import Foundation
import Capacitor
import Photos
import UIKit

/// Collega l'app alla libreria Foto di iPhone:
/// elenco foto, immagini ridimensionate, spostamento in "Eliminati di recente", album.
@objc(GalleriaPlugin)
public class GalleriaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GalleriaPlugin"
    public let jsName = "Galleria"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCache", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trash", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addToAlbum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listVideos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSizes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private var cacheDir: URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("galleria", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func state(_ s: PHAuthorizationStatus) -> [String: Any] {
        return ["granted": s == .authorized || s == .limited, "limited": s == .limited]
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if s == .notDetermined {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { ns in call.resolve(self.state(ns)) }
        } else {
            call.resolve(state(s))
        }
    }

    @objc func listPhotos(_ call: CAPPluginCall) {
        let fromMs = call.getDouble("fromMs") ?? 0
        DispatchQueue.global(qos: .userInitiated).async {
            let opts = PHFetchOptions()
            opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            if fromMs > 0 {
                opts.predicate = NSPredicate(format: "creationDate >= %@", Date(timeIntervalSince1970: fromMs / 1000) as NSDate)
            }
            // foto arrivate da app di messaggi (album con quel nome)
            var appOf: [String: String] = [:]
            let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
            albums.enumerateObjects { col, _, _ in
                guard let t = col.localizedTitle?.lowercased() else { return }
                let app = t.contains("whatsapp") ? "WhatsApp" : t.contains("telegram") ? "Telegram" : t.contains("messenger") ? "Messenger" : t.contains("instagram") ? "Instagram" : ""
                if app.isEmpty { return }
                PHAsset.fetchAssets(in: col, options: nil).enumerateObjects { a, _, _ in appOf[a.localIdentifier] = app }
            }
            let res = PHAsset.fetchAssets(with: .image, options: opts)
            var out: [[String: Any]] = []
            out.reserveCapacity(res.count)
            res.enumerateObjects { a, _, _ in
                out.append([
                    "id": a.localIdentifier,
                    "date": (a.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
                    "mod": (a.modificationDate?.timeIntervalSince1970 ?? 0),
                    "width": a.pixelWidth,
                    "height": a.pixelHeight,
                    "screenshot": a.mediaSubtypes.contains(.photoScreenshot),
                    "live": a.mediaSubtypes.contains(.photoLive),
                    "app": appOf[a.localIdentifier] ?? ""
                ])
            }
            call.resolve(["photos": out])
        }
    }

    @objc func listVideos(_ call: CAPPluginCall) {
        let fromMs = call.getDouble("fromMs") ?? 0
        DispatchQueue.global(qos: .userInitiated).async {
            let opts = PHFetchOptions()
            opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            if fromMs > 0 {
                opts.predicate = NSPredicate(format: "creationDate >= %@", Date(timeIntervalSince1970: fromMs / 1000) as NSDate)
            }
            let res = PHAsset.fetchAssets(with: .video, options: opts)
            var out: [[String: Any]] = []
            res.enumerateObjects { a, _, _ in
                out.append([
                    "id": a.localIdentifier,
                    "date": (a.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
                    "mod": (a.modificationDate?.timeIntervalSince1970 ?? 0),
                    "duration": a.duration,
                    "width": a.pixelWidth,
                    "height": a.pixelHeight,
                    "size": self.fileSize(a).main
                ])
            }
            call.resolve(["videos": out])
        }
    }

    /// Peso del file principale e dell'eventuale video della Live Photo.
    private func fileSize(_ a: PHAsset) -> (main: Int, live: Int) {
        var main = 0, live = 0
        for r in PHAssetResource.assetResources(for: a) {
            let sz = (r.value(forKey: "fileSize") as? NSNumber)?.intValue ?? 0
            switch r.type {
            case .photo, .video: main = max(main, sz)
            case .pairedVideo: live = max(live, sz)
            default: break
            }
        }
        return (main, live)
    }

    @objc func getSizes(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        DispatchQueue.global(qos: .utility).async {
            var out: [String: Any] = [:]
            PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { a, _, _ in
                let s = self.fileSize(a)
                out[a.localIdentifier] = ["size": s.main, "live": s.live]
            }
            call.resolve(["sizes": out])
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        call.reject("Su iPhone le foto si recuperano dall'album Eliminati di recente.")
    }

    private func asset(_ id: String) -> PHAsset? {
        return PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject
    }

    @objc func getImage(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let a = asset(id) else { call.reject("Foto non trovata"); return }
        let maxSize = CGFloat(call.getInt("maxSize") ?? 1280)
        let quality = CGFloat(call.getInt("quality") ?? 85) / 100
        let safeName = id.replacingOccurrences(of: "/", with: "_")
        let file = cacheDir.appendingPathComponent("\(safeName)_\(Int(maxSize)).jpg")
        if FileManager.default.fileExists(atPath: file.path) { call.resolve(["path": file.path]); return }
        let o = PHImageRequestOptions()
        o.deliveryMode = .highQualityFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true   // foto su iCloud
        o.isSynchronous = false
        PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: maxSize, height: maxSize), contentMode: .aspectFit, options: o) { img, info in
            if let deg = info?[PHImageResultIsDegradedKey] as? Bool, deg { return }
            guard let img = img, let data = img.jpegData(compressionQuality: quality) else { call.reject("Foto non leggibile"); return }
            do { try data.write(to: file); call.resolve(["path": file.path]) } catch { call.reject("Errore di scrittura") }
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: cacheDir)
        call.resolve()
    }

    @objc func trash(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        if assets.count == 0 { call.resolve(["deleted": true]); return }
        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest.deleteAssets(assets)
        }) { ok, err in
            if ok { call.resolve(["deleted": true, "ok": true]); return }
            if let e = err as NSError?, e.domain == PHPhotosErrorDomain, e.code == PHPhotosError.userCancelled.rawValue {
                call.resolve(["deleted": false]); return
            }
            if err == nil { call.resolve(["deleted": false]); return }
            call.reject("Non riesco a eliminare le foto: \(err!.localizedDescription)")
        }
    }

    @objc func addToAlbum(_ call: CAPPluginCall) {
        let name = call.getString("album") ?? "Senza nome"
        let ids = call.getArray("ids", String.self) ?? []
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        let fo = PHFetchOptions()
        fo.predicate = NSPredicate(format: "title = %@", name)
        let existing = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: fo).firstObject
        PHPhotoLibrary.shared().performChanges({
            let req: PHAssetCollectionChangeRequest?
            if let col = existing {
                req = PHAssetCollectionChangeRequest(for: col)
            } else {
                req = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: name)
            }
            req?.addAssets(assets)
        }) { ok, err in
            if ok { call.resolve(["added": assets.count]) } else { call.reject("Non riesco a creare l'album: \(err?.localizedDescription ?? "")") }
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}
