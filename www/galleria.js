"use strict";
// Strato che collega l'app alla galleria del telefono (plugin nativo "Galleria").
// Nel browser del computer (per provare) usa invece la scelta di file classica.
window.Galleria = (() => {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const plugin = isNative ? ((cap.Plugins && cap.Plugins.Galleria) || cap.registerPlugin('Galleria')) : null;
  const platform = isNative ? cap.getPlatform() : 'web';
  if (isNative) document.documentElement.classList.add('native'), document.addEventListener('DOMContentLoaded', () => document.body.classList.add('native'));

  async function nativeChoose(days) {
    const acc = await plugin.requestAccess();
    if (!acc.granted) throw new Error('permesso');
    const fromMs = days > 0 ? Date.now() - days * 86400000 : 0;
    const { photos } = await plugin.listPhotos({ fromMs });
    const items = photos.map(p => ({
      id: p.id, name: p.name || '', path: p.name || '', date: p.date || 0, w: p.width || 0, h: p.height || 0, size: p.size || 0,
      load: maxSize => loadNative(p.id, maxSize),
    }));
    return { items, limited: !!acc.limited };
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
        const files = [...(input.files || [])];
        resolve({ items: files.map((f, i) => ({ id: 'f' + i, name: f.name, path: f.webkitRelativePath || f.name, date: 0, w: 0, h: 0, size: f.size, file: f, load: async () => f })), limited: false });
      };
      input.onchange = done; input.oncancel = done;
      input.click();
    });
  }

  return {
    isNative, platform,
    choose: (days, input) => isNative ? nativeChoose(days) : webChoose(input),
    async trash(items) {
      if (!isNative) throw new Error('Disponibile solo nell\'app sul telefono.');
      const r = await plugin.trash({ ids: items.map(p => p.id) });
      return !!r.deleted;
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
