"use strict";
// Strato che collega l'app alla galleria del telefono (plugin nativo "Galleria").
// Nel browser del computer (per provare) usa invece la scelta di file classica.
window.Galleria = (() => {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const plugin = isNative ? ((cap.Plugins && cap.Plugins.Galleria) || cap.registerPlugin('Galleria')) : null;
  const platform = isNative ? cap.getPlatform() : 'web';
  if (isNative) document.documentElement.classList.add('native'), document.addEventListener('DOMContentLoaded', () => document.body.classList.add('native'));
  const fromOf = days => days > 0 ? Date.now() - days * 86400000 : 0;

  async function access() {
    const acc = await plugin.requestAccess();
    if (!acc.granted) throw new Error('permesso');
    return !!acc.limited;
  }
  const nativeItem = (p, kind) => ({
    id: p.id, key: p.id + ':' + (p.mod || p.date || 0), kind, name: p.name || '', path: p.name || '', date: p.date || 0,
    w: p.width || 0, h: p.height || 0, size: p.size || 0, duration: p.duration || 0,
    screenshot: !!p.screenshot, app: p.app || '', live: !!p.live, liveSize: 0,
    load: maxSize => loadNative(p.id, maxSize),
  });
  async function nativeChoose(days) {
    const limited = await access();
    const { photos } = await plugin.listPhotos({ fromMs: fromOf(days) });
    return { items: photos.map(p => nativeItem(p, 'photo')), limited };
  }
  async function loadNative(id, maxSize) {
    const { path } = await plugin.getImage({ id, maxSize, quality: maxSize > 1000 ? 88 : 80 });
    const r = await fetch(cap.convertFileSrc(path));
    if (!r.ok) throw new Error('immagine non leggibile');
    return r.blob();
  }

  function webChoose(input) {
    return new Promise(resolve => {
      input.value = '';
      const done = () => {
        input.onchange = input.oncancel = null;
        const files = [...(input.files || [])].filter(f => !f.type || f.type.startsWith('image/'));
        resolve({ items: files.map(f => ({
          id: 'f:' + f.name + ':' + f.size + ':' + f.lastModified, key: 'f:' + f.name + ':' + f.size + ':' + f.lastModified, kind: 'photo',
          name: f.name, path: f.webkitRelativePath || f.name, date: 0, w: 0, h: 0, size: f.size, file: f,
          screenshot: /^screenshot|^schermata/i.test(f.name), app: /-WA\d{4}|whatsapp/i.test(f.name) ? 'WhatsApp' : '', live: false, liveSize: 0,
          load: async () => f })), limited: false });
      };
      input.onchange = done; input.oncancel = done;
      input.click();
    });
  }

  return {
    isNative, platform,
    canRestore: platform === 'android',
    choose: (days, input) => isNative ? nativeChoose(days) : webChoose(input),
    async videos(days) {
      if (!isNative) return [];
      await access();
      const { videos } = await plugin.listVideos({ fromMs: fromOf(days) });
      return videos.map(v => nativeItem(v, 'video'));
    },
    // Su iPhone il peso dei file si legge a parte (è più lento): lo completo a blocchi.
    async fillSizes(items, onUpdate) {
      if (platform !== 'ios') return;
      const todo = items.filter(p => !p.size);
      for (let i = 0; i < todo.length; i += 200) {
        const chunk = todo.slice(i, i + 200);
        try {
          const { sizes } = await plugin.getSizes({ ids: chunk.map(p => p.id) });
          for (const p of chunk) { const s = sizes[p.id]; if (s) { p.size = s.size || 0; p.liveSize = s.live || 0; } }
        } catch (e) { console.warn(e); }
        if (onUpdate) onUpdate();
      }
    },
    async trash(items) {
      if (!isNative) throw new Error('Disponibile solo nell\'app sul telefono.');
      const ids = items.map(p => p.id);
      const r = await plugin.trash({ ids });
      const ok = !!(r.deleted || r.ok);
      if (ok && platform === 'android') localStorage.setItem('ultime-spostate', JSON.stringify(ids));
      return ok;
    },
    lastTrashed() { try { return JSON.parse(localStorage.getItem('ultime-spostate') || '[]'); } catch (e) { return []; } },
    async restoreLast() {
      const ids = this.lastTrashed();
      if (!ids.length) return 0;
      const r = await plugin.restore({ ids });
      if (r.ok || r.deleted) { localStorage.removeItem('ultime-spostate'); return ids.length; }
      return 0;
    },
    async addToAlbum(album, items) {
      if (!isNative) throw new Error('Disponibile solo nell\'app sul telefono.');
      const r = await plugin.addToAlbum({ album, ids: items.map(p => p.id) });
      return r.added || 0;
    },
    async clearCache() { if (isNative) try { await plugin.clearCache(); } catch (e) {} },
    async keepAwake(on) { if (isNative) try { await plugin.keepAwake({ on }); } catch (e) {} },
  };
})();
