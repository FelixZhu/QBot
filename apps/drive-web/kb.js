/* Knowledge-base tab. Mounts into #tab-kb when present.
   Reads ./index.json (or window.KB_INDEX). Dispatches "kb:open" on file click. */
(function () {
  "use strict";

  var INDEX_URL = "index.json";
  var KIND_ICON = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/><path d="M3 7V6a1 1 0 0 1 1-1h5l2 2"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l6 6v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/><text x="12" y="18" text-anchor="middle" font-size="6" stroke="none" fill="currentColor" font-weight="700">PDF</text></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l6 6v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/><path d="M10 13.5v4l3.5-2z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l6 6v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/><path d="M9 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/><path d="M10.5 15.5V12l4-1v2.5"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l6 6v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/></svg>'
  };
  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var DIR_LABEL = {reports:"报告",videos:"视频",bilibili:"B站视频",xiaoyuzhou:"小宇宙播客",xhs:"小红书",docs:"文档"};
  /* Directory segments that look like object hashes (8+ hex chars) stay out of the UI. */
  function isHashSeg(s) {
    return /^[0-9a-f]{8,}$/i.test(s || "");
  }
  function visibleDirParts(dir) {
    return String(dir || "").split("/").filter(Boolean).filter(function (p) { return !isHashSeg(p); });
  }
  function visiblePath(dir) {
    return visibleDirParts(dir).join("/");
  }
  function dirTitle(name) {
    if (!name || isHashSeg(name)) return "";
    return DIR_LABEL[name] ? (name + " · " + DIR_LABEL[name]) : name;
  }
  function formatDir(dir) {
    var parts = visibleDirParts(dir);
    if (!parts.length) return dir ? "其他" : "根目录";
    return parts.map(dirTitle).filter(Boolean).join(" / ");
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function icon(kind) {
    return '<span class="kb-fi" data-t="' + esc(kind || "file") + '">' + (KIND_ICON[kind] || KIND_ICON.file) + "</span>";
  }
  function human(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
    return (n / 1073741824).toFixed(1) + " GB";
  }
  function fmtDate(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000), now = new Date();
    var start = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
    var diff = (start(now) - start(d)) / 86400000;
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    if (d.getFullYear() === now.getFullYear()) return mm + "-" + dd;
    return d.getFullYear() + "-" + mm + "-" + dd;
  }
  function basename(key) { return (key || "").split("/").pop(); }
  function topDir(f) { return visibleDirParts(f.dir)[0] || "其他"; }
  function mark(text, q) {
    var s = esc(text || "");
    if (!q) return s;
    var parts = q.trim().split(/\s+/).filter(Boolean).map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    if (!parts.length) return s;
    var re = new RegExp("(" + parts.join("|") + ")", "ig");
    return s.replace(re, "<mark>$1</mark>");
  }

  function buildTree(files) {
    var root = {};
    files.forEach(function (f) {
      if (f.private) return;
      var parts = visibleDirParts(f.dir);
      var node = root;
      var path = "";
      parts.forEach(function (p) {
        path = path ? path + "/" + p : p;
        if (!node[p]) node[p] = { name: p, path: path, count: 0, children: {}, files: [] };
        node[p].count += 1;
        node = node[p].children;
      });
    });
    function toList(map) {
      return Object.keys(map).sort().map(function (k) {
        var n = map[k];
        n.kids = toList(n.children);
        return n;
      });
    }
    return toList(root);
  }

  function uniqueTags(files) {
    var kinds = [], topics = [], seenK = {}, seenT = {};
    files.forEach(function (f) {
      if (f.private) return;
      if (f.doc_type && !seenK[f.doc_type]) { seenK[f.doc_type] = 1; kinds.push(f.doc_type); }
      (f.tags || []).forEach(function (t) {
        if (t && !seenK[t] && !seenT[t]) { seenT[t] = 1; topics.push(t); }
      });
    });
    var order = { "PDF": 1, "视频": 2, "音频": 3, "图片": 4, "文档": 5 };
    kinds.sort(function (a, b) { return (order[a] || 9) - (order[b] || 9) || a.localeCompare(b, "zh"); });
    topics.sort(function (a, b) { return a.localeCompare(b, "zh"); });
    return kinds.concat(topics);
  }

  function matchFile(f, q, chips) {
    if (f.private) return false;
    if (chips && chips.length) {
      var ok = chips.every(function (c) {
        if (f.doc_type === c) return true;
        return (f.tags || []).indexOf(c) >= 0;
      });
      if (!ok) return false;
    }
    if (!q) return true;
    var hay = ((f.name || "") + " " + (f.summary || "") + " " + (f.key || "") + " " + (f.tags || []).join(" ")).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w.toLowerCase()) >= 0; });
  }

  function KB(el, data) {
    this.el = el;
    this.data = data;
    this.files = (data.files || []).slice();
    this.q = "";
    this.chips = [];
    this.folder = "";
    this.selected = null;
    this.openFolders = {};
    this.render();
  }

  KB.prototype.filtered = function () {
    var self = this;
    return this.files.filter(function (f) {
      if (self.folder) {
        var vis = visiblePath(f.dir);
        if (!(vis === self.folder || vis.indexOf(self.folder + "/") === 0)) return false;
      }
      return matchFile(f, self.q, self.chips);
    });
  };

  KB.prototype.render = function () {
    var el = this.el;
    el.classList.add("kb");
    el.innerHTML =
      '<div class="kb-pane">' +
        '<div class="kb-topbar"><span class="kb-title">知识库</span></div>' +
        '<div class="kb-search' + (this.q ? " has-q" : "") + '">' + SEARCH +
          '<input type="search" id="kb-q" placeholder="搜文件名和摘要" value="' + esc(this.q) + '" autocomplete="off" enterkeyhint="search">' +
          '<button type="button" class="kb-clear" id="kb-clear" aria-label="清除">×</button>' +
        '</div>' +
        '<div class="kb-chips-wrap" id="kb-chips-wrap"><div class="kb-chips" id="kb-chips"></div></div>' +
        '<button type="button" class="kb-vault" id="kb-vault">' +
          '<span class="kb-ic">' + LOCK + '</span>' +
          '<span class="kb-t"><span class="kb-n">私密区</span><span class="kb-m">尚未配置</span></span>' +
          '<span class="kb-cnt" id="kb-vault-cnt"></span>' + CHEV.replace("<svg", '<svg class="kb-chev"') +
        '</button>' +
        '<div class="kb-scroll scroller" id="kb-pane-scroll"></div>' +
      '</div>' +
      '<div class="kb-main"><div class="kb-scroll scroller" id="kb-main-scroll"></div></div>' +
      '<div class="kb-scrim" id="kb-scrim"></div>' +
      '<div class="kb-sheet" id="kb-sheet" role="dialog" aria-labelledby="kb-sheet-title" hidden>' +
        '<h3 id="kb-sheet-title">私密区</h3>' +
        '<p>尚未配置。开通后，私密文件会放在这里，不会出现在公开列表里。</p>' +
        '<button type="button" class="kb-ok" id="kb-sheet-ok">知道了</button>' +
      '</div>';
    this.bind();
    this.drawChips();
    this.drawLists();
    this.updateChipFade();
  };

  KB.prototype.bind = function () {
    var self = this;
    var input = this.el.querySelector("#kb-q");
    input.addEventListener("input", function () {
      self.q = input.value;
      self.selected = null;
      self.el.querySelector(".kb-search").classList.toggle("has-q", !!self.q);
      self.drawLists();
    });
    this.el.querySelector("#kb-clear").addEventListener("click", function () {
      self.q = ""; input.value = ""; self.el.querySelector(".kb-search").classList.remove("has-q"); self.drawLists(); input.focus();
    });
    this.el.querySelector("#kb-vault").addEventListener("click", function () { self.openSheet(); });
    var chips = this.el.querySelector("#kb-chips");
    if (chips) chips.addEventListener("scroll", function () { self.updateChipFade(); }, {passive: true});
    if (!KB._resizeBound) {
      KB._resizeBound = true;
      window.addEventListener("resize", function () {
        if (inst) inst.updateChipFade();
      });
    }
    this.el.querySelector("#kb-scrim").addEventListener("click", function () { self.closeSheet(); });
    this.el.querySelector("#kb-sheet-ok").addEventListener("click", function () { self.closeSheet(); });
    var sheetEl = this.el.querySelector("#kb-sheet"), y0 = null, dy = 0;
    sheetEl.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; dy = 0; sheetEl.style.transition = "none"; }, {passive: true});
    sheetEl.addEventListener("touchmove", function (e) {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (window.matchMedia("(max-width:599px)").matches) sheetEl.style.transform = "translateY(" + dy + "px)";
    }, {passive: true});
    sheetEl.addEventListener("touchend", function () {
      sheetEl.style.transition = ""; sheetEl.style.transform = "";
      if (y0 != null && dy > 60) self.closeSheet();
      y0 = null;
    });
    this.el.addEventListener("click", function (e) {
      var tw = e.target.closest(".kb-tw");
      if (tw) {
        var tp = tw.parentNode.getAttribute("data-folder");
        if (tp) {
          e.stopPropagation();
          self.openFolders[tp] = !self.isExpanded(tp);
          if (!self.openFolders[tp] && self.folder && (self.folder === tp || self.folder.indexOf(tp + "/") === 0)) {
            self.folder = tp.indexOf("/") >= 0 ? tp.slice(0, tp.lastIndexOf("/")) : "";
            self.selected = null;
          }
          self.drawLists();
          return;
        }
      }
      if (e.target.closest("[data-kb-back]")) { self.back(); return; }
      var chip = e.target.closest(".kb-chip");
      if (chip) {
        var tag = chip.getAttribute("data-tag");
        if (!tag) { self.chips = []; }
        else {
          var i = self.chips.indexOf(tag);
          if (i >= 0) self.chips.splice(i, 1); else self.chips.push(tag);
        }
        self.drawChips(); self.drawLists();
        return;
      }
      var ti = e.target.closest("[data-folder]");
      if (ti) {
        var p = ti.getAttribute("data-folder") || "";
        if (p && self.folder !== p) self.openFolders[p] = true;
        self.folder = self.folder === p ? "" : p;
        if (!self.folder) { /* keep open state */ }
        self.selected = null;
        self.drawLists(true);
        return;
      }
      var row = e.target.closest("[data-key]");
      if (row) {
        var key = row.getAttribute("data-key");
        var file = self.files.filter(function (f) { return f.key === key; })[0];
        if (file) self.openFile(file);
      }
    });
  };

  KB.prototype.openSheet = function () {
    var sheet = this.el.querySelector("#kb-sheet");
    clearTimeout(this._sheetT);
    sheet.hidden = false;
    this.el.classList.add("is-sheet");
  };
  KB.prototype.closeSheet = function () {
    this.el.classList.remove("is-sheet");
    var sheet = this.el.querySelector("#kb-sheet");
    clearTimeout(this._sheetT);
    this._sheetT = setTimeout(function () { sheet.hidden = true; }, 280);
  };

  /* Hook used by the tab shell: window.qbotKb.back() — no args.
     Return true if this call consumed the back gesture, false if already
     at the knowledge-base home (the shell then switches to the 对话 tab). */
  KB.prototype.back = function () {
    if (this.el && this.el.classList.contains("is-sheet")) {
      this.closeSheet();
      return true;
    }
    if (this.selected) {
      this.selected = null;
      this.drawLists(true);
      return true;
    }
    if (this.q) {
      this.q = "";
      var qi = this.el.querySelector("#kb-q");
      if (qi) { qi.value = ""; qi.blur(); }
      this.el.querySelector(".kb-search").classList.remove("has-q");
      this.drawLists(true);
      return true;
    }
    if (this.folder) {
      var slash = this.folder.lastIndexOf("/");
      this.folder = slash >= 0 ? this.folder.slice(0, slash) : "";
      this.selected = null;
      this.drawLists(true);
      return true;
    }
    return false;
  };

  KB.prototype.openFile = function (file) {
    this.selected = file.key;
    this.el.dispatchEvent(new CustomEvent("kb:open", { bubbles: true, detail: file }));
    this.drawPane(this.filtered(), !!this.q);
    this.drawMain(this.filtered(), !!this.q);
    this.topMain();
  };

  /* Open a file by OSS key from outside (e.g. a Feed card). Returns false if unknown or private. */
  KB.prototype.openKey = function (key) {
    var f = this.files.filter(function (x) { return x.key === key && !x.private; })[0];
    if (!f) return false;
    this.closeSheet();
    this.q = ""; this.chips = [];
    var qi = this.el.querySelector("#kb-q"); if (qi) qi.value = "";
    this.el.querySelector(".kb-search").classList.remove("has-q");
    this.folder = visiblePath(f.dir);
    if (this.folder) this.openFolders[this.folder] = true;
    this.drawChips();
    this.openFile(f);
    return true;
  };

  KB.prototype.topMain = function () {
    var m = this.el.querySelector("#kb-main-scroll");
    if (m) m.scrollTop = 0;
    if (window.matchMedia && window.matchMedia("(max-width:599px)").matches) {
      var t = this.el.getBoundingClientRect().top;
      if (t < 0) window.scrollBy(0, t);
    }
  };

  KB.prototype.isExpanded = function (path) {
    if (path in this.openFolders) return !!this.openFolders[path];
    var f = this.folder;
    return !!f && (f === path || f.indexOf(path + "/") === 0);
  };

  KB.prototype.drawChips = function () {
    var tags = uniqueTags(this.files);
    var allOn = !this.chips.length;
    var html = '<button type="button" class="kb-chip' + (allOn ? " on" : "") + '" data-tag="">全部</button>' +
      tags.map(function (t) {
        var on = this.chips.indexOf(t) >= 0;
        return '<button type="button" class="kb-chip' + (on ? " on" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
      }, this).join("");
    this.el.querySelector("#kb-chips").innerHTML = html;
    var self = this;
    requestAnimationFrame(function () { self.updateChipFade(); });
  };

  KB.prototype.updateChipFade = function () {
    var wrap = this.el && this.el.querySelector("#kb-chips-wrap");
    var el = this.el && this.el.querySelector("#kb-chips");
    if (!wrap || !el) return;
    var can = el.scrollWidth > el.clientWidth + 1;
    var atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    wrap.classList.toggle("is-overflow", can && !atEnd);
  };

  KB.prototype.drawLists = function (toTop) {
    var files = this.filtered();
    var searching = !!this.q;
    this.drawPane(files, searching);
    this.drawMain(files, searching);
    this.updateChipFade();
    if (toTop) this.topMain();
  };

  KB.prototype.drawPane = function (files, searching) {
    var pane = this.el.querySelector("#kb-pane-scroll");
    var tree = buildTree(this.files);
    var self = this;
    function walk(nodes, depth) {
      return nodes.map(function (n) {
        var on = self.folder === n.path;
        var expanded = self.isExpanded(n.path);
        var pad = 8 + depth * 20;
        var row = '<button type="button" class="kb-ti' + (on && !self.selected ? " on" : "") + '" data-folder="' + esc(n.path) + '" style="padding-left:' + pad + 'px">' +
          '<span class="kb-tw' + (expanded ? " open" : "") + '">' + CHEV + "</span>" +
          icon("folder") + '<span class="kb-lbl">' + esc(dirTitle(n.name)) + '</span><span class="kb-cnt">' + n.count + "</span></button>";
        var kids = "";
        if (expanded) {
          self.files.filter(function (f) { return !f.private && visiblePath(f.dir) === n.path; }).forEach(function (f) {
            var sel = self.selected === f.key;
            kids += '<button type="button" class="kb-ti' + (sel ? " on" : "") + '" data-key="' + esc(f.key) + '" style="padding-left:' + (pad + 20) + 'px">' +
              icon(f.kind) + '<span class="kb-lbl">' + esc(f.name) + "</span></button>";
          });
          kids += walk(n.kids, depth + 1);
        }
        return row + kids;
      }).join("");
    }
    var body = '<div class="kb-tree">' +
      '<button type="button" class="kb-ti' + (!this.folder && !this.selected ? " on" : "") + '" data-folder="" style="padding-left:8px">' +
      icon("folder") + '<span class="kb-lbl">全部文件</span><span class="kb-cnt">' + this.files.filter(function (f) { return !f.private; }).length + "</span></button>" +
      walk(tree, 0) + "</div>";
    pane.innerHTML = body;
  };

  KB.prototype.fileRow = function (f, asSearch) {
    var meta = [formatDir(f.dir), human(f.size), fmtDate(f.mtime)].filter(Boolean).join(" · ");
    if (asSearch) {
      return '<button type="button" class="kb-sr" data-key="' + esc(f.key) + '">' + icon(f.kind) +
        '<span class="kb-t"><span class="kb-n">' + mark(f.name, this.q) + '</span>' +
        '<span class="kb-p">' + esc(formatDir(f.dir)) + "</span>" +
        (f.summary ? '<span class="kb-s">' + mark(f.summary, this.q) + "</span>" : "") +
        ((f.tags || []).length ? '<span class="kb-tags">' + f.tags.map(function (t) { return '<span class="kb-tag">' + esc(t) + "</span>"; }).join("") + "</span>" : "") +
        "</span></button>";
    }
    return '<button type="button" class="kb-row" data-key="' + esc(f.key) + '">' + icon(f.kind) +
      '<span class="kb-t"><span class="kb-n">' + esc(f.name) + "</span>" +
      (f.summary ? '<span class="kb-s">' + esc(f.summary) + "</span>" : "") +
      '<span class="kb-m">' + esc(meta) + "</span></span></button>";
  };

  KB.prototype.drawMain = function (files, searching) {
    var main = this.el.querySelector("#kb-main-scroll");
    var old = main.querySelector("video,audio");
    if (old) { try { old.pause(); } catch (e) {} }
    this.el.classList.toggle("is-detail", !!this.selected);
    if (this.selected) {
      var f = this.files.filter(function (x) { return x.key === this.selected; }, this)[0];
      if (f) { main.innerHTML = this.detailHtml(f); return; }
    }
    if (searching) {
      var nPriv = 0;
      var html = files.map(function (f) { return this.fileRow(f, true); }, this).join("");
      if (!files.length) html = '<div class="kb-empty">没有找到相关文件</div>';
      else html = '<div class="kb-sec">搜索结果 · ' + files.length + " 个</div>" + html;
      if (nPriv) html += '<div class="kb-empty">私密文件 ' + nPriv + " 个匹配</div>";
      main.innerHTML = html;
      return;
    }
    var recent = files.slice().sort(function (a, b) { return b.mtime - a.mtime; });
    var title = this.folder ? (formatDir(this.folder) || dirTitle(basename(this.folder))) : "最近更新";
    var back = "";
    if (this.folder && window.matchMedia && window.matchMedia("(max-width:599px)").matches) {
      back = '<button type="button" class="kb-row" data-folder="">' + icon("folder") +
        '<span class="kb-t"><span class="kb-n">全部文件</span><span class="kb-m">返回知识库首页</span></span></button>';
    }
    var body = back + (recent.length
      ? '<div class="kb-sec">' + esc(title) + (this.folder ? " · " + recent.length + " 个" : "") + "</div>" + recent.map(function (f) { return this.fileRow(f, false); }, this).join("")
      : '<div class="kb-empty">这个文件夹是空的</div>');
    /* Folded home also lists folders in the main column when no folder is chosen */
    var folders = "";
    if (!this.folder && window.matchMedia && window.matchMedia("(max-width:599px)").matches) {
      var tops = {};
      this.files.forEach(function (f) {
        if (f.private) return;
        var t = topDir(f);
        if (!tops[t]) tops[t] = { name: t, path: t, count: 0, size: 0 };
        tops[t].count += 1; tops[t].size += f.size || 0;
      });
      folders = '<div class="kb-sec">文件夹</div>' + Object.keys(tops).sort().map(function (k) {
        var d = tops[k];
        return '<button type="button" class="kb-row" data-folder="' + esc(d.path) + '">' + icon("folder") +
          '<span class="kb-t"><span class="kb-n">' + esc(dirTitle(d.name)) + "</span></span>" +
          '<span class="kb-cnt">' + d.count + "</span>" + CHEV.replace("<svg", '<svg class="kb-chev"') + "</button>";
      }).join("");
    }
    main.innerHTML = folders + body;
  };

  KB.prototype.detailHtml = function (f) {
    var meta = [formatDir(f.dir), human(f.size), fmtDate(f.mtime), f.doc_type].filter(Boolean).join(" · ");
    var url = (this.data.base ? this.data.base.replace(/\/$/, "") + "/" + encodeURI(f.key) : "");
    var player = "";
    if (url && f.kind === "video") player = '<video class="kb-media" src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
    else if (url && f.kind === "audio") player = '<audio class="kb-media" src="' + esc(url) + '" controls preload="metadata"></audio>';
    var backTo = this.q ? "返回搜索结果" : (this.folder ? "返回 " + (formatDir(this.folder) || "文件夹") : "返回知识库");
    return '<div class="kb-detail">' +
      '<button type="button" class="kb-back" data-kb-back="1">' + CHEV.replace("<svg", '<svg class="kb-back-ic"') + "<span>" + esc(backTo) + "</span></button>" +
      (player || icon(f.kind)) +
      "<h2>" + esc(f.name) + "</h2>" +
      (f.summary ? '<p class="kb-s">' + esc(f.summary) + "</p>" : "") +
      '<p class="kb-m">' + esc(meta) + "</p>" +
      ((f.tags || []).length ? '<div class="kb-tags">' + f.tags.map(function (t) { return '<span class="kb-tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      (url ? '<a class="kb-open" href="' + esc(url) + '" target="_blank" rel="noopener">' + (player ? "用其他应用打开" : "打开文件") + "</a>" : "") +
      "</div>";
  };

  var inst = null;
  function pauseMedia(root) {
    Array.prototype.forEach.call(root.querySelectorAll("video,audio"), function (m) { try { m.pause(); } catch (e) {} });
  }
  function mount(el, data) {
    inst = new KB(el, data || { files: [] });
    /* Stop playback when the tab is switched away or the app goes to background */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (x) { if (!x.isIntersecting) pauseMedia(el); });
      }).observe(el);
    }
    document.addEventListener("visibilitychange", function () { if (document.hidden) pauseMedia(el); });
    /* Shell hides tabs with visibility+inert, which IntersectionObserver can't see */
    window.addEventListener("qbot:tab", function (e) {
      var t = e.detail && e.detail.tab;
      if (t && t !== "kb") pauseMedia(el);
    });
    return inst;
  }

  function boot() {
    var el = document.getElementById("tab-kb");
    if (!el || el.getAttribute("data-kb-ready")) return;
    el.setAttribute("data-kb-ready", "1");
    if (window.KB_INDEX) { mount(el, window.KB_INDEX); return; }
    fetch(INDEX_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("index " + r.status);
      return r.json();
    }).then(function (data) { mount(el, data); }).catch(function () {
      mount(el, { files: [] });
      var main = el.querySelector("#kb-main-scroll");
      if (main) main.innerHTML = '<div class="kb-empty">打不开索引，检查网络后重试</div>';
    });
  }

  window.KB = { mount: mount, boot: boot };
  /* chat-demo shell: if (window.qbotKb.back()) return true; else leave the tab. */
  window.qbotKb = {
    back: function () { return !!(inst && inst.back()); },
    /* Switch to the 知识库 tab and show this file's detail. */
    open: function (key) {
      if (!inst) return false;
      if (typeof window.qbotTab === "function") window.qbotTab("kb");
      return inst.openKey(key);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
