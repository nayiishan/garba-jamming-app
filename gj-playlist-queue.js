/**
 * gj-playlist-queue.js
 * Reads every video ID from saved YouTube / YT Music playlists
 * using a hidden YouTube IFrame player (cuePlaylist + getPlaylist).
 * No API key required.
 */
window.GJPlaylistQueue = (function () {
  'use strict';

  var DEFAULT_PLAYLIST = 'PLWfMLjZuX3nECAxZMzh1fTphRH1UxZvEj';
  var STORAGE_KEY      = 'gj_playlists_v1';
  var READ_TIMEOUT_MS  = 10000;
  var SETTLE_MS        = 2000;

  function extractPlaylistId(url) {
    if (!url || typeof url !== 'string') return null;
    var t = url.trim();
    if (t.indexOf('PLiOkCwQzPydzWlRtgIS84XqtDu0g4UGOR') !== -1) return null;
    if (/^[A-Za-z0-9_-]{10,}$/.test(t) && !/\s/.test(t)) return { type: 'playlist', id: t };
    var mList = t.match(/[?&]list=([A-Za-z0-9_-]+)/);
    if (mList && mList[1] !== 'PLiOkCwQzPydzWlRtgIS84XqtDu0g4UGOR') return { type: 'playlist', id: mList[1] };
    var mVid = t.match(/(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (mVid) return { type: 'video', id: mVid[1] };
    return null;
  }

  function getPlaylistEntries() {
    var entries = [];
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        var data = JSON.parse(raw);
        var ytm = (data.ytm || []).filter(function(u){ return u && u.indexOf('PLiOkCwQzPydzWlRtgIS84XqtDu0g4UGOR') === -1; });
        var yt  = (data.yt  || []).filter(function(u){ return u && u.indexOf('PLiOkCwQzPydzWlRtgIS84XqtDu0g4UGOR') === -1; });
        [].concat(ytm, yt).forEach(function (url) {
          var item = extractPlaylistId(url);
          if (item) entries.push(item);
        });
        if (entries.length > 0) return entries;
      }
    } catch (e) {}
    entries.push({ type: 'playlist', id: DEFAULT_PLAYLIST });
    return entries;
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function readOneEntry(player, entry) {
    if (entry.type === 'video') {
      return Promise.resolve([entry.id]);
    }
    var pid = entry.id;
    return new Promise(function (resolve) {
      var done = false, tries = 0;
      var maxTries = Math.ceil((READ_TIMEOUT_MS - SETTLE_MS) / 500);
      var timer = setTimeout(function () { if (!done) { done=true; resolve([]); } }, READ_TIMEOUT_MS);

      function poll() {
        if (done) return;
        tries++;
        try {
          var list = player.getPlaylist();
          if (list && list.length > 0) {
            clearTimeout(timer); done = true; resolve(list); return;
          }
        } catch (e) {}
        if (tries < maxTries) setTimeout(poll, 500);
        else { clearTimeout(timer); if (!done) { done=true; resolve([]); } }
      }

      try {
        player.setVolume(0);
        player.loadPlaylist({ listType: 'playlist', list: pid, index: 0 });
        setTimeout(poll, 800);
      } catch (e) {
        try {
          player.cuePlaylist({ listType: 'playlist', list: pid, index: 0 });
          setTimeout(poll, SETTLE_MS);
        } catch (err) { clearTimeout(timer); if (!done) { done=true; resolve([]); } }
      }
    });
  }

  function build(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var playlistEntries = getPlaylistEntries();
      var reports = playlistEntries.map(function (entry) {
        return { playlist: entry.id, status: 'pending', tracks: 0 };
      });

      var mountId = opts.mount || 'playlist-reader';
      var mountEl = document.getElementById(mountId);
      if (!mountEl) {
        mountEl = document.createElement('div');
        mountEl.id = mountId;
        document.body.appendChild(mountEl);
      }
      mountEl.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;top:-9999px;left:-9999px;';

      var innerDiv = document.createElement('div');
      var innerId  = mountId + '-yt';
      innerDiv.id  = innerId;
      mountEl.appendChild(innerDiv);

      try {
        new YT.Player(innerId, {
          width: 1, height: 1,
          playerVars: { autoplay: 0, controls: 0, fs: 0 },
          events: {
            onReady: function (e) {
              var player = e.target;
              var allIds = [], idx = 0;
              function readNext() {
                if (idx >= playlistEntries.length) {
                  var seen = {}, deduped = allIds.filter(function (id) {
                    return seen[id] ? false : (seen[id] = true);
                  });
                  resolve({ ids: shuffleArray(deduped), reports: reports });
                  return;
                }
                var entry = playlistEntries[idx], report = reports[idx++];
                readOneEntry(player, entry).then(function (ids) {
                  if (ids && ids.length) { report.status = 'ok'; report.tracks = ids.length; allIds = allIds.concat(ids); }
                  else report.status = 'failed/timeout';
                  readNext();
                });
              }
              readNext();
            },
            onError: function () { resolve({ ids: [], reports: reports }); }
          }
        });
      } catch (e) { resolve({ ids: [], reports: reports }); }
    });
  }

  return { build: build };
})();
