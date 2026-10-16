"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from2, except, desc) => {
    if (from2 && typeof from2 === "object" || typeof from2 === "function") {
      for (let key of __getOwnPropNames(from2))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/shims/buffer.js
  function concat(list) {
    const total = (list || []).reduce((sum, item) => sum + item.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const item of list || []) {
      merged.set(item, offset);
      offset += item.length;
    }
    return merged;
  }
  function byteLength(value) {
    return new TextEncoder().encode(String(value == null ? "" : value)).length;
  }
  function isBuffer(value) {
    return value instanceof Uint8Array;
  }
  function from(value, encoding) {
    if (typeof value === "string") {
      if (encoding === "hex") {
        const out = new Uint8Array(value.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
        return out;
      }
      if (encoding === "base64" || encoding === "base64url") {
        const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
        const binary = window.atob(normalized);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
      }
      return new TextEncoder().encode(value);
    }
    return new Uint8Array(value || 0);
  }
  var BufferShim, buffer_default;
  var init_buffer = __esm({
    "src/shims/buffer.js"() {
      "use strict";
      init_globals();
      BufferShim = class extends Uint8Array {
        toString(encoding) {
          if (encoding === "hex") {
            let out = "";
            for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, "0");
            return out;
          }
          return new TextDecoder("utf-8").decode(this);
        }
      };
      buffer_default = Object.assign(BufferShim, { concat, byteLength, isBuffer, from });
    }
  });

  // src/shims/globals.js
  var __foliaProcessEnv, __foliaDirname;
  var init_globals = __esm({
    "src/shims/globals.js"() {
      "use strict";
      init_buffer();
      __foliaProcessEnv = {
        QISHUI_COOKIE_FILE: "/folia/qishui-cookie.txt",
        QISHUI_TOKEN_FILE: "/folia/qishui-token.txt",
        QISHUI_QR_CONFIG_FILE: "/folia/qishui-qr-login.json",
        QISHUI_OAUTH_CONFIG_FILE: "/folia/qishui-oauth.json"
      };
      __foliaDirname = "/folia";
    }
  });

  // src/shims/fs.js
  var fs_exports = {};
  __export(fs_exports, {
    default: () => fs_default,
    existsSync: () => existsSync,
    mkdirSync: () => mkdirSync,
    readFileSync: () => readFileSync,
    unlinkAllByPrefix: () => unlinkAllByPrefix,
    unlinkSync: () => unlinkSync,
    writeFileSync: () => writeFileSync
  });
  function keyOf(file) {
    return PREFIX + String(file);
  }
  function existsSync(file) {
    const key = keyOf(file);
    if (memory.has(key)) return true;
    try {
      return window.localStorage.getItem(key) !== null;
    } catch (_) {
      return false;
    }
  }
  function readFileSync(file, _encoding) {
    const key = keyOf(file);
    if (memory.has(key)) return memory.get(key);
    let value = null;
    try {
      value = window.localStorage.getItem(key);
    } catch (_) {
      value = null;
    }
    if (value === null) {
      const error = new Error("ENOENT: no such file, open '" + file + "'");
      error.code = "ENOENT";
      throw error;
    }
    return value;
  }
  function writeFileSync(file, data) {
    const key = keyOf(file);
    const value = data == null ? "" : String(data);
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch (_) {
    }
  }
  function mkdirSync() {
  }
  function unlinkSync(file) {
    const key = keyOf(file);
    memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch (_) {
    }
  }
  function unlinkAllByPrefix(prefix) {
    const needle = PREFIX + String(prefix || "");
    const touched = [];
    for (const key of Array.from(memory.keys())) {
      if (key.indexOf(needle) === 0) touched.push(key);
    }
    for (const key of touched) memory.delete(key);
    try {
      const store = window.localStorage;
      const removals = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.indexOf(needle) === 0) removals.push(key);
      }
      for (const key of removals) store.removeItem(key);
    } catch (_) {
    }
  }
  var PREFIX, memory, fs_default;
  var init_fs = __esm({
    "src/shims/fs.js"() {
      "use strict";
      init_globals();
      PREFIX = "qishui:fs:";
      memory = /* @__PURE__ */ new Map();
      fs_default = { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, unlinkAllByPrefix };
    }
  });

  // src/shims/crypto.js
  var crypto_exports = {};
  __export(crypto_exports, {
    createHash: () => createHash,
    default: () => crypto_default,
    randomBytes: () => randomBytes,
    randomInt: () => randomInt,
    randomUUID: () => randomUUID
  });
  function utf8Bytes(text) {
    return new TextEncoder().encode(String(text));
  }
  function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }
  function randomValues(length) {
    const bytes = new Uint8Array(length);
    const cryptoRef = win.crypto || win.msCrypto;
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function") {
      for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    }
    for (let offset = 0; offset < length; offset += 65536) {
      cryptoRef.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)));
    }
    return bytes;
  }
  function sha1Digest(message) {
    const bytes = message instanceof Uint8Array ? message : utf8Bytes(message);
    const bitLength = bytes.length * 8;
    const padded = new Uint8Array((bytes.length + 8 >> 6) + 1 << 6);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false);
    let h0 = 1732584193, h1 = 4023233417, h2 = 2562383102, h3 = 271733878, h4 = 3285377520;
    const w = new Uint32Array(80);
    for (let block = 0; block < padded.length; block += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
      for (let i = 16; i < 80; i++) {
        const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = n << 1 | n >>> 31;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = b & c | ~b & d;
          k = 1518500249;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 1859775393;
        } else if (i < 60) {
          f = b & c | b & d | c & d;
          k = 2400959708;
        } else {
          f = b ^ c ^ d;
          k = 3395469782;
        }
        const temp = (a << 5 | a >>> 27) + f + e + k + w[i] >>> 0;
        e = d;
        d = c;
        c = b << 30 | b >>> 2;
        b = a;
        a = temp;
      }
      h0 = h0 + a >>> 0;
      h1 = h1 + b >>> 0;
      h2 = h2 + c >>> 0;
      h3 = h3 + d >>> 0;
      h4 = h4 + e >>> 0;
    }
    const out = new Uint8Array(20);
    new DataView(out.buffer).setUint32(0, h0, false);
    new DataView(out.buffer).setUint32(4, h1, false);
    new DataView(out.buffer).setUint32(8, h2, false);
    new DataView(out.buffer).setUint32(12, h3, false);
    new DataView(out.buffer).setUint32(16, h4, false);
    return out;
  }
  function md5Digest(message) {
    const bytes = message instanceof Uint8Array ? message : utf8Bytes(message);
    const bitLengthLow = bytes.length * 8 >>> 0;
    const bitLengthHigh = Math.floor(bytes.length * 8 / 4294967296) >>> 0;
    const padded = new Uint8Array((bytes.length + 8 >> 6) + 1 << 6);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLengthLow, true);
    view.setUint32(padded.length - 4, bitLengthHigh, true);
    const S = [
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21
    ];
    let K = md5Digest.K;
    if (!K) {
      K = md5Digest.K = new Uint32Array(64);
      for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }
    let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
    const M = new Uint32Array(16);
    for (let block = 0; block < padded.length; block += 64) {
      for (let i = 0; i < 16; i++) M[i] = view.getUint32(block + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) {
          F = B & C | ~B & D;
          g = i;
        } else if (i < 32) {
          F = D & B | ~D & C;
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = B ^ C ^ D;
          g = (3 * i + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = 7 * i % 16;
        }
        F = F + A + K[i] + M[g] >>> 0;
        A = D;
        D = C;
        C = B;
        B = B + (F << S[i] | F >>> 32 - S[i]) >>> 0;
      }
      a0 = a0 + A >>> 0;
      b0 = b0 + B >>> 0;
      c0 = c0 + C >>> 0;
      d0 = d0 + D >>> 0;
    }
    const out = new Uint8Array(16);
    new DataView(out.buffer).setUint32(0, a0, true);
    new DataView(out.buffer).setUint32(4, b0, true);
    new DataView(out.buffer).setUint32(8, c0, true);
    new DataView(out.buffer).setUint32(12, d0, true);
    return out;
  }
  function base64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return win.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function createHash(kind) {
    return new Hash(String(kind || "").toLowerCase());
  }
  function randomBytes(length) {
    const bytes = randomValues(length);
    bytes.toString = function(encoding) {
      if (encoding === "hex") return bytesToHex(this);
      if (encoding === "base64url") return base64Url(this);
      let binary = "";
      for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
      return win.btoa(binary);
    };
    return bytes;
  }
  function randomUUID() {
    const bytes = randomValues(16);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = bytesToHex(bytes);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }
  function randomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) return low;
    const range = high - low;
    const bytes = randomValues(4);
    const value = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
    return low + value % range;
  }
  var win, Hash, crypto_default;
  var init_crypto = __esm({
    "src/shims/crypto.js"() {
      "use strict";
      init_globals();
      win = typeof window !== "undefined" ? window : globalThis;
      Hash = class {
        constructor(kind) {
          this.kind = kind;
          this.chunks = [];
        }
        update(data) {
          this.chunks.push(data instanceof Uint8Array ? data : utf8Bytes(data));
          return this;
        }
        digest(encoding) {
          const merged = new Uint8Array(this.chunks.reduce((total, chunk) => total + chunk.length, 0));
          let offset = 0;
          for (const chunk of this.chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const digest = this.kind === "sha1" ? sha1Digest(merged) : md5Digest(merged);
          if (encoding === "hex") return bytesToHex(digest);
          if (encoding === "base64url") return base64Url(digest);
          if (encoding === "base64") {
            let binary = "";
            for (let i = 0; i < digest.length; i++) binary += String.fromCharCode(digest[i]);
            return win.btoa(binary);
          }
          return digest;
        }
      };
      crypto_default = { createHash, randomBytes, randomUUID, randomInt };
    }
  });

  // src/shims/http.js
  var http_exports = {};
  __export(http_exports, {
    default: () => http_default,
    request: () => request
  });
  function normalizeUrl(url) {
    return typeof url === "string" ? url : String(url && url.href || url);
  }
  function wrapResponse(native) {
    const listeners = { data: [], end: [], error: [] };
    const response = {
      statusCode: Number(native && native.status) || 0,
      headers: native && native.headers || {},
      text: String(native && native.body || ""),
      on(event, listener) {
        if (listeners[event] && typeof listener === "function") listeners[event].push(listener);
        return this;
      },
      _drain() {
        Promise.resolve().then(() => {
          for (const listener of listeners.data) {
            try {
              listener(buffer_default.from(response.text, "utf8"));
            } catch (_) {
            }
          }
          for (const listener of listeners.end) {
            try {
              listener();
            } catch (_) {
            }
          }
        });
      }
    };
    return response;
  }
  function request(url, options, callback) {
    return new ClientRequest(url, options, callback);
  }
  var ClientRequest, http_default;
  var init_http = __esm({
    "src/shims/http.js"() {
      "use strict";
      init_globals();
      ClientRequest = class {
        constructor(url, options, callback) {
          this.url = normalizeUrl(url);
          this.options = options || {};
          this.callback = typeof callback === "function" ? callback : null;
          this.errorListeners = [];
          this.timeoutTimer = null;
          this.aborted = false;
          this.chunks = [];
          this.timeoutMs = 2e4;
        }
        setTimeout(ms, handler) {
          const value = Number(ms) || 0;
          if (value > 0) this.timeoutMs = value;
          if (typeof handler === "function") this.timeoutHandler = handler;
          return this;
        }
        on(event, listener) {
          if (event === "error" && typeof listener === "function") this.errorListeners.push(listener);
          return this;
        }
        write(chunk) {
          if (chunk != null) this.chunks.push(String(chunk));
          return this;
        }
        end(chunk) {
          if (chunk != null) this.chunks.push(String(chunk));
          this._dispatch();
          return this;
        }
        destroy(error) {
          this.aborted = true;
          if (error) this._fail(error);
          return this;
        }
        _fail(error) {
          for (const listener of this.errorListeners) {
            try {
              listener(error);
            } catch (_) {
            }
          }
        }
        _dispatch() {
          const transport = window.__foliaHttpTransport;
          if (!transport || typeof transport.request !== "function") {
            this._fail(new Error("native http transport is unavailable"));
            return;
          }
          const payload = {
            url: this.url,
            method: String(this.options.method || "GET").toUpperCase(),
            headers: this.options.headers || {},
            body: this.chunks.length ? this.chunks.join("") : null,
            timeoutMs: Number(this.options.timeoutMs) > 0 ? Number(this.options.timeoutMs) : this.timeoutMs
          };
          const started = Date.now();
          transport.request(payload).then((native) => {
            if (this.aborted) return;
            const response = wrapResponse(native);
            if (this.callback) {
              try {
                this.callback(response);
              } catch (error) {
                this._fail(error);
              }
            }
            response._drain();
          }).catch((error) => {
            if (this.aborted) return;
            this._fail(error instanceof Error ? error : new Error(String(error)));
          });
        }
      };
      http_default = { request, ClientRequest };
    }
  });

  // src/shims/https.js
  var https_exports = {};
  __export(https_exports, {
    default: () => http_default,
    request: () => request
  });
  var init_https = __esm({
    "src/shims/https.js"() {
      "use strict";
      init_globals();
      init_http();
    }
  });

  // src/shims/path.js
  var path_exports = {};
  __export(path_exports, {
    default: () => path_default,
    dirname: () => dirname,
    join: () => join,
    resolve: () => resolve
  });
  function join(...parts) {
    const segments = (parts || []).filter((part) => part != null && String(part) !== "").map(String);
    if (!segments.length) return ".";
    const joined = segments.join("/").replace(/\/{2,}/g, "/");
    return normalize(joined);
  }
  function dirname(file) {
    const value = String(file || "");
    const index = value.lastIndexOf("/");
    if (index < 0) return ".";
    if (index === 0) return "/";
    return normalize(value.slice(0, index));
  }
  function resolve(...parts) {
    return join(...parts);
  }
  function normalize(value) {
    let out = value;
    while (/\/\.\//.test(out)) out = out.replace(/\/\.\//g, "/");
    if (out.endsWith("/.")) out = out.slice(0, -2);
    return out || "/";
  }
  var path_default;
  var init_path = __esm({
    "src/shims/path.js"() {
      "use strict";
      init_globals();
      path_default = { join, dirname, resolve, normalize };
    }
  });

  // src/shims/os.js
  var os_exports = {};
  __export(os_exports, {
    default: () => os_default,
    hostname: () => hostname,
    platform: () => platform
  });
  function hostname() {
    return "Folia-Android";
  }
  function platform() {
    return "android";
  }
  var os_default;
  var init_os = __esm({
    "src/shims/os.js"() {
      "use strict";
      init_globals();
      os_default = { hostname, platform };
    }
  });

  // src/shims/electron.js
  var electron_exports = {};
  __export(electron_exports, {
    BrowserWindow: () => BrowserWindow,
    app: () => app,
    default: () => electron_default,
    session: () => session
  });
  var electron_default, BrowserWindow, app, session;
  var init_electron = __esm({
    "src/shims/electron.js"() {
      "use strict";
      init_globals();
      electron_default = {};
      BrowserWindow = void 0;
      app = void 0;
      session = void 0;
    }
  });

  // ../../node_modules/qrcode/lib/can-promise.js
  var require_can_promise = __commonJS({
    "../../node_modules/qrcode/lib/can-promise.js"(exports, module) {
      init_globals();
      module.exports = function() {
        return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/utils.js
  var require_utils = __commonJS({
    "../../node_modules/qrcode/lib/core/utils.js"(exports) {
      init_globals();
      var toSJISFunction;
      var CODEWORDS_COUNT = [
        0,
        // Not used
        26,
        44,
        70,
        100,
        134,
        172,
        196,
        242,
        292,
        346,
        404,
        466,
        532,
        581,
        655,
        733,
        815,
        901,
        991,
        1085,
        1156,
        1258,
        1364,
        1474,
        1588,
        1706,
        1828,
        1921,
        2051,
        2185,
        2323,
        2465,
        2611,
        2761,
        2876,
        3034,
        3196,
        3362,
        3532,
        3706
      ];
      exports.getSymbolSize = function getSymbolSize(version) {
        if (!version) throw new Error('"version" cannot be null or undefined');
        if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
        return version * 4 + 17;
      };
      exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
        return CODEWORDS_COUNT[version];
      };
      exports.getBCHDigit = function(data) {
        let digit = 0;
        while (data !== 0) {
          digit++;
          data >>>= 1;
        }
        return digit;
      };
      exports.setToSJISFunction = function setToSJISFunction(f) {
        if (typeof f !== "function") {
          throw new Error('"toSJISFunc" is not a valid function.');
        }
        toSJISFunction = f;
      };
      exports.isKanjiModeEnabled = function() {
        return typeof toSJISFunction !== "undefined";
      };
      exports.toSJIS = function toSJIS(kanji) {
        return toSJISFunction(kanji);
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/error-correction-level.js
  var require_error_correction_level = __commonJS({
    "../../node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
      init_globals();
      exports.L = { bit: 1 };
      exports.M = { bit: 0 };
      exports.Q = { bit: 3 };
      exports.H = { bit: 2 };
      function fromString(string) {
        if (typeof string !== "string") {
          throw new Error("Param is not a string");
        }
        const lcStr = string.toLowerCase();
        switch (lcStr) {
          case "l":
          case "low":
            return exports.L;
          case "m":
          case "medium":
            return exports.M;
          case "q":
          case "quartile":
            return exports.Q;
          case "h":
          case "high":
            return exports.H;
          default:
            throw new Error("Unknown EC Level: " + string);
        }
      }
      exports.isValid = function isValid(level) {
        return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
      };
      exports.from = function from2(value, defaultValue) {
        if (exports.isValid(value)) {
          return value;
        }
        try {
          return fromString(value);
        } catch (e) {
          return defaultValue;
        }
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/bit-buffer.js
  var require_bit_buffer = __commonJS({
    "../../node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
      init_globals();
      function BitBuffer() {
        this.buffer = [];
        this.length = 0;
      }
      BitBuffer.prototype = {
        get: function(index) {
          const bufIndex = Math.floor(index / 8);
          return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
        },
        put: function(num, length) {
          for (let i = 0; i < length; i++) {
            this.putBit((num >>> length - i - 1 & 1) === 1);
          }
        },
        getLengthInBits: function() {
          return this.length;
        },
        putBit: function(bit) {
          const bufIndex = Math.floor(this.length / 8);
          if (this.buffer.length <= bufIndex) {
            this.buffer.push(0);
          }
          if (bit) {
            this.buffer[bufIndex] |= 128 >>> this.length % 8;
          }
          this.length++;
        }
      };
      module.exports = BitBuffer;
    }
  });

  // ../../node_modules/qrcode/lib/core/bit-matrix.js
  var require_bit_matrix = __commonJS({
    "../../node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
      init_globals();
      function BitMatrix(size) {
        if (!size || size < 1) {
          throw new Error("BitMatrix size must be defined and greater than 0");
        }
        this.size = size;
        this.data = new Uint8Array(size * size);
        this.reservedBit = new Uint8Array(size * size);
      }
      BitMatrix.prototype.set = function(row, col, value, reserved) {
        const index = row * this.size + col;
        this.data[index] = value;
        if (reserved) this.reservedBit[index] = true;
      };
      BitMatrix.prototype.get = function(row, col) {
        return this.data[row * this.size + col];
      };
      BitMatrix.prototype.xor = function(row, col, value) {
        this.data[row * this.size + col] ^= value;
      };
      BitMatrix.prototype.isReserved = function(row, col) {
        return this.reservedBit[row * this.size + col];
      };
      module.exports = BitMatrix;
    }
  });

  // ../../node_modules/qrcode/lib/core/alignment-pattern.js
  var require_alignment_pattern = __commonJS({
    "../../node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
      init_globals();
      var getSymbolSize = require_utils().getSymbolSize;
      exports.getRowColCoords = function getRowColCoords(version) {
        if (version === 1) return [];
        const posCount = Math.floor(version / 7) + 2;
        const size = getSymbolSize(version);
        const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
        const positions = [size - 7];
        for (let i = 1; i < posCount - 1; i++) {
          positions[i] = positions[i - 1] - intervals;
        }
        positions.push(6);
        return positions.reverse();
      };
      exports.getPositions = function getPositions(version) {
        const coords = [];
        const pos = exports.getRowColCoords(version);
        const posLength = pos.length;
        for (let i = 0; i < posLength; i++) {
          for (let j = 0; j < posLength; j++) {
            if (i === 0 && j === 0 || // top-left
            i === 0 && j === posLength - 1 || // bottom-left
            i === posLength - 1 && j === 0) {
              continue;
            }
            coords.push([pos[i], pos[j]]);
          }
        }
        return coords;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/finder-pattern.js
  var require_finder_pattern = __commonJS({
    "../../node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
      init_globals();
      var getSymbolSize = require_utils().getSymbolSize;
      var FINDER_PATTERN_SIZE = 7;
      exports.getPositions = function getPositions(version) {
        const size = getSymbolSize(version);
        return [
          // top-left
          [0, 0],
          // top-right
          [size - FINDER_PATTERN_SIZE, 0],
          // bottom-left
          [0, size - FINDER_PATTERN_SIZE]
        ];
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/mask-pattern.js
  var require_mask_pattern = __commonJS({
    "../../node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
      init_globals();
      exports.Patterns = {
        PATTERN000: 0,
        PATTERN001: 1,
        PATTERN010: 2,
        PATTERN011: 3,
        PATTERN100: 4,
        PATTERN101: 5,
        PATTERN110: 6,
        PATTERN111: 7
      };
      var PenaltyScores = {
        N1: 3,
        N2: 3,
        N3: 40,
        N4: 10
      };
      exports.isValid = function isValid(mask) {
        return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
      };
      exports.from = function from2(value) {
        return exports.isValid(value) ? parseInt(value, 10) : void 0;
      };
      exports.getPenaltyN1 = function getPenaltyN1(data) {
        const size = data.size;
        let points = 0;
        let sameCountCol = 0;
        let sameCountRow = 0;
        let lastCol = null;
        let lastRow = null;
        for (let row = 0; row < size; row++) {
          sameCountCol = sameCountRow = 0;
          lastCol = lastRow = null;
          for (let col = 0; col < size; col++) {
            let module2 = data.get(row, col);
            if (module2 === lastCol) {
              sameCountCol++;
            } else {
              if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
              lastCol = module2;
              sameCountCol = 1;
            }
            module2 = data.get(col, row);
            if (module2 === lastRow) {
              sameCountRow++;
            } else {
              if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
              lastRow = module2;
              sameCountRow = 1;
            }
          }
          if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
          if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
        }
        return points;
      };
      exports.getPenaltyN2 = function getPenaltyN2(data) {
        const size = data.size;
        let points = 0;
        for (let row = 0; row < size - 1; row++) {
          for (let col = 0; col < size - 1; col++) {
            const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
            if (last === 4 || last === 0) points++;
          }
        }
        return points * PenaltyScores.N2;
      };
      exports.getPenaltyN3 = function getPenaltyN3(data) {
        const size = data.size;
        let points = 0;
        let bitsCol = 0;
        let bitsRow = 0;
        for (let row = 0; row < size; row++) {
          bitsCol = bitsRow = 0;
          for (let col = 0; col < size; col++) {
            bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
            if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
            bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
            if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
          }
        }
        return points * PenaltyScores.N3;
      };
      exports.getPenaltyN4 = function getPenaltyN4(data) {
        let darkCount = 0;
        const modulesCount = data.data.length;
        for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
        const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
        return k * PenaltyScores.N4;
      };
      function getMaskAt(maskPattern, i, j) {
        switch (maskPattern) {
          case exports.Patterns.PATTERN000:
            return (i + j) % 2 === 0;
          case exports.Patterns.PATTERN001:
            return i % 2 === 0;
          case exports.Patterns.PATTERN010:
            return j % 3 === 0;
          case exports.Patterns.PATTERN011:
            return (i + j) % 3 === 0;
          case exports.Patterns.PATTERN100:
            return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
          case exports.Patterns.PATTERN101:
            return i * j % 2 + i * j % 3 === 0;
          case exports.Patterns.PATTERN110:
            return (i * j % 2 + i * j % 3) % 2 === 0;
          case exports.Patterns.PATTERN111:
            return (i * j % 3 + (i + j) % 2) % 2 === 0;
          default:
            throw new Error("bad maskPattern:" + maskPattern);
        }
      }
      exports.applyMask = function applyMask(pattern, data) {
        const size = data.size;
        for (let col = 0; col < size; col++) {
          for (let row = 0; row < size; row++) {
            if (data.isReserved(row, col)) continue;
            data.xor(row, col, getMaskAt(pattern, row, col));
          }
        }
      };
      exports.getBestMask = function getBestMask(data, setupFormatFunc) {
        const numPatterns = Object.keys(exports.Patterns).length;
        let bestPattern = 0;
        let lowerPenalty = Infinity;
        for (let p = 0; p < numPatterns; p++) {
          setupFormatFunc(p);
          exports.applyMask(p, data);
          const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
          exports.applyMask(p, data);
          if (penalty < lowerPenalty) {
            lowerPenalty = penalty;
            bestPattern = p;
          }
        }
        return bestPattern;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/error-correction-code.js
  var require_error_correction_code = __commonJS({
    "../../node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
      init_globals();
      var ECLevel = require_error_correction_level();
      var EC_BLOCKS_TABLE = [
        // L  M  Q  H
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        2,
        2,
        1,
        2,
        2,
        4,
        1,
        2,
        4,
        4,
        2,
        4,
        4,
        4,
        2,
        4,
        6,
        5,
        2,
        4,
        6,
        6,
        2,
        5,
        8,
        8,
        4,
        5,
        8,
        8,
        4,
        5,
        8,
        11,
        4,
        8,
        10,
        11,
        4,
        9,
        12,
        16,
        4,
        9,
        16,
        16,
        6,
        10,
        12,
        18,
        6,
        10,
        17,
        16,
        6,
        11,
        16,
        19,
        6,
        13,
        18,
        21,
        7,
        14,
        21,
        25,
        8,
        16,
        20,
        25,
        8,
        17,
        23,
        25,
        9,
        17,
        23,
        34,
        9,
        18,
        25,
        30,
        10,
        20,
        27,
        32,
        12,
        21,
        29,
        35,
        12,
        23,
        34,
        37,
        12,
        25,
        34,
        40,
        13,
        26,
        35,
        42,
        14,
        28,
        38,
        45,
        15,
        29,
        40,
        48,
        16,
        31,
        43,
        51,
        17,
        33,
        45,
        54,
        18,
        35,
        48,
        57,
        19,
        37,
        51,
        60,
        19,
        38,
        53,
        63,
        20,
        40,
        56,
        66,
        21,
        43,
        59,
        70,
        22,
        45,
        62,
        74,
        24,
        47,
        65,
        77,
        25,
        49,
        68,
        81
      ];
      var EC_CODEWORDS_TABLE = [
        // L  M  Q  H
        7,
        10,
        13,
        17,
        10,
        16,
        22,
        28,
        15,
        26,
        36,
        44,
        20,
        36,
        52,
        64,
        26,
        48,
        72,
        88,
        36,
        64,
        96,
        112,
        40,
        72,
        108,
        130,
        48,
        88,
        132,
        156,
        60,
        110,
        160,
        192,
        72,
        130,
        192,
        224,
        80,
        150,
        224,
        264,
        96,
        176,
        260,
        308,
        104,
        198,
        288,
        352,
        120,
        216,
        320,
        384,
        132,
        240,
        360,
        432,
        144,
        280,
        408,
        480,
        168,
        308,
        448,
        532,
        180,
        338,
        504,
        588,
        196,
        364,
        546,
        650,
        224,
        416,
        600,
        700,
        224,
        442,
        644,
        750,
        252,
        476,
        690,
        816,
        270,
        504,
        750,
        900,
        300,
        560,
        810,
        960,
        312,
        588,
        870,
        1050,
        336,
        644,
        952,
        1110,
        360,
        700,
        1020,
        1200,
        390,
        728,
        1050,
        1260,
        420,
        784,
        1140,
        1350,
        450,
        812,
        1200,
        1440,
        480,
        868,
        1290,
        1530,
        510,
        924,
        1350,
        1620,
        540,
        980,
        1440,
        1710,
        570,
        1036,
        1530,
        1800,
        570,
        1064,
        1590,
        1890,
        600,
        1120,
        1680,
        1980,
        630,
        1204,
        1770,
        2100,
        660,
        1260,
        1860,
        2220,
        720,
        1316,
        1950,
        2310,
        750,
        1372,
        2040,
        2430
      ];
      exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
        switch (errorCorrectionLevel) {
          case ECLevel.L:
            return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
          case ECLevel.M:
            return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
          case ECLevel.Q:
            return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
          case ECLevel.H:
            return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
          default:
            return void 0;
        }
      };
      exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
        switch (errorCorrectionLevel) {
          case ECLevel.L:
            return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
          case ECLevel.M:
            return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
          case ECLevel.Q:
            return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
          case ECLevel.H:
            return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
          default:
            return void 0;
        }
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/galois-field.js
  var require_galois_field = __commonJS({
    "../../node_modules/qrcode/lib/core/galois-field.js"(exports) {
      init_globals();
      var EXP_TABLE = new Uint8Array(512);
      var LOG_TABLE = new Uint8Array(256);
      (function initTables() {
        let x = 1;
        for (let i = 0; i < 255; i++) {
          EXP_TABLE[i] = x;
          LOG_TABLE[x] = i;
          x <<= 1;
          if (x & 256) {
            x ^= 285;
          }
        }
        for (let i = 255; i < 512; i++) {
          EXP_TABLE[i] = EXP_TABLE[i - 255];
        }
      })();
      exports.log = function log(n) {
        if (n < 1) throw new Error("log(" + n + ")");
        return LOG_TABLE[n];
      };
      exports.exp = function exp(n) {
        return EXP_TABLE[n];
      };
      exports.mul = function mul(x, y) {
        if (x === 0 || y === 0) return 0;
        return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/polynomial.js
  var require_polynomial = __commonJS({
    "../../node_modules/qrcode/lib/core/polynomial.js"(exports) {
      init_globals();
      var GF = require_galois_field();
      exports.mul = function mul(p1, p2) {
        const coeff = new Uint8Array(p1.length + p2.length - 1);
        for (let i = 0; i < p1.length; i++) {
          for (let j = 0; j < p2.length; j++) {
            coeff[i + j] ^= GF.mul(p1[i], p2[j]);
          }
        }
        return coeff;
      };
      exports.mod = function mod(divident, divisor) {
        let result = new Uint8Array(divident);
        while (result.length - divisor.length >= 0) {
          const coeff = result[0];
          for (let i = 0; i < divisor.length; i++) {
            result[i] ^= GF.mul(divisor[i], coeff);
          }
          let offset = 0;
          while (offset < result.length && result[offset] === 0) offset++;
          result = result.slice(offset);
        }
        return result;
      };
      exports.generateECPolynomial = function generateECPolynomial(degree) {
        let poly = new Uint8Array([1]);
        for (let i = 0; i < degree; i++) {
          poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
        }
        return poly;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/reed-solomon-encoder.js
  var require_reed_solomon_encoder = __commonJS({
    "../../node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
      init_globals();
      var Polynomial = require_polynomial();
      function ReedSolomonEncoder(degree) {
        this.genPoly = void 0;
        this.degree = degree;
        if (this.degree) this.initialize(this.degree);
      }
      ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
        this.degree = degree;
        this.genPoly = Polynomial.generateECPolynomial(this.degree);
      };
      ReedSolomonEncoder.prototype.encode = function encode(data) {
        if (!this.genPoly) {
          throw new Error("Encoder not initialized");
        }
        const paddedData = new Uint8Array(data.length + this.degree);
        paddedData.set(data);
        const remainder = Polynomial.mod(paddedData, this.genPoly);
        const start = this.degree - remainder.length;
        if (start > 0) {
          const buff = new Uint8Array(this.degree);
          buff.set(remainder, start);
          return buff;
        }
        return remainder;
      };
      module.exports = ReedSolomonEncoder;
    }
  });

  // ../../node_modules/qrcode/lib/core/version-check.js
  var require_version_check = __commonJS({
    "../../node_modules/qrcode/lib/core/version-check.js"(exports) {
      init_globals();
      exports.isValid = function isValid(version) {
        return !isNaN(version) && version >= 1 && version <= 40;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/regex.js
  var require_regex = __commonJS({
    "../../node_modules/qrcode/lib/core/regex.js"(exports) {
      init_globals();
      var numeric = "[0-9]+";
      var alphanumeric = "[A-Z $%*+\\-./:]+";
      var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
      kanji = kanji.replace(/u/g, "\\u");
      var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
      exports.KANJI = new RegExp(kanji, "g");
      exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
      exports.BYTE = new RegExp(byte, "g");
      exports.NUMERIC = new RegExp(numeric, "g");
      exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
      var TEST_KANJI = new RegExp("^" + kanji + "$");
      var TEST_NUMERIC = new RegExp("^" + numeric + "$");
      var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
      exports.testKanji = function testKanji(str) {
        return TEST_KANJI.test(str);
      };
      exports.testNumeric = function testNumeric(str) {
        return TEST_NUMERIC.test(str);
      };
      exports.testAlphanumeric = function testAlphanumeric(str) {
        return TEST_ALPHANUMERIC.test(str);
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/mode.js
  var require_mode = __commonJS({
    "../../node_modules/qrcode/lib/core/mode.js"(exports) {
      init_globals();
      var VersionCheck = require_version_check();
      var Regex = require_regex();
      exports.NUMERIC = {
        id: "Numeric",
        bit: 1 << 0,
        ccBits: [10, 12, 14]
      };
      exports.ALPHANUMERIC = {
        id: "Alphanumeric",
        bit: 1 << 1,
        ccBits: [9, 11, 13]
      };
      exports.BYTE = {
        id: "Byte",
        bit: 1 << 2,
        ccBits: [8, 16, 16]
      };
      exports.KANJI = {
        id: "Kanji",
        bit: 1 << 3,
        ccBits: [8, 10, 12]
      };
      exports.MIXED = {
        bit: -1
      };
      exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
        if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
        if (!VersionCheck.isValid(version)) {
          throw new Error("Invalid version: " + version);
        }
        if (version >= 1 && version < 10) return mode.ccBits[0];
        else if (version < 27) return mode.ccBits[1];
        return mode.ccBits[2];
      };
      exports.getBestModeForData = function getBestModeForData(dataStr) {
        if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
        else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
        else if (Regex.testKanji(dataStr)) return exports.KANJI;
        else return exports.BYTE;
      };
      exports.toString = function toString(mode) {
        if (mode && mode.id) return mode.id;
        throw new Error("Invalid mode");
      };
      exports.isValid = function isValid(mode) {
        return mode && mode.bit && mode.ccBits;
      };
      function fromString(string) {
        if (typeof string !== "string") {
          throw new Error("Param is not a string");
        }
        const lcStr = string.toLowerCase();
        switch (lcStr) {
          case "numeric":
            return exports.NUMERIC;
          case "alphanumeric":
            return exports.ALPHANUMERIC;
          case "kanji":
            return exports.KANJI;
          case "byte":
            return exports.BYTE;
          default:
            throw new Error("Unknown mode: " + string);
        }
      }
      exports.from = function from2(value, defaultValue) {
        if (exports.isValid(value)) {
          return value;
        }
        try {
          return fromString(value);
        } catch (e) {
          return defaultValue;
        }
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/version.js
  var require_version = __commonJS({
    "../../node_modules/qrcode/lib/core/version.js"(exports) {
      init_globals();
      var Utils = require_utils();
      var ECCode = require_error_correction_code();
      var ECLevel = require_error_correction_level();
      var Mode = require_mode();
      var VersionCheck = require_version_check();
      var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
      var G18_BCH = Utils.getBCHDigit(G18);
      function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
        for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
          if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
            return currentVersion;
          }
        }
        return void 0;
      }
      function getReservedBitsCount(mode, version) {
        return Mode.getCharCountIndicator(mode, version) + 4;
      }
      function getTotalBitsFromDataArray(segments, version) {
        let totalBits = 0;
        segments.forEach(function(data) {
          const reservedBits = getReservedBitsCount(data.mode, version);
          totalBits += reservedBits + data.getBitsLength();
        });
        return totalBits;
      }
      function getBestVersionForMixedData(segments, errorCorrectionLevel) {
        for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
          const length = getTotalBitsFromDataArray(segments, currentVersion);
          if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
            return currentVersion;
          }
        }
        return void 0;
      }
      exports.from = function from2(value, defaultValue) {
        if (VersionCheck.isValid(value)) {
          return parseInt(value, 10);
        }
        return defaultValue;
      };
      exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
        if (!VersionCheck.isValid(version)) {
          throw new Error("Invalid QR Code version");
        }
        if (typeof mode === "undefined") mode = Mode.BYTE;
        const totalCodewords = Utils.getSymbolTotalCodewords(version);
        const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
        const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
        if (mode === Mode.MIXED) return dataTotalCodewordsBits;
        const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
        switch (mode) {
          case Mode.NUMERIC:
            return Math.floor(usableBits / 10 * 3);
          case Mode.ALPHANUMERIC:
            return Math.floor(usableBits / 11 * 2);
          case Mode.KANJI:
            return Math.floor(usableBits / 13);
          case Mode.BYTE:
          default:
            return Math.floor(usableBits / 8);
        }
      };
      exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
        let seg;
        const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
        if (Array.isArray(data)) {
          if (data.length > 1) {
            return getBestVersionForMixedData(data, ecl);
          }
          if (data.length === 0) {
            return 1;
          }
          seg = data[0];
        } else {
          seg = data;
        }
        return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
      };
      exports.getEncodedBits = function getEncodedBits(version) {
        if (!VersionCheck.isValid(version) || version < 7) {
          throw new Error("Invalid QR Code version");
        }
        let d = version << 12;
        while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
          d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
        }
        return version << 12 | d;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/format-info.js
  var require_format_info = __commonJS({
    "../../node_modules/qrcode/lib/core/format-info.js"(exports) {
      init_globals();
      var Utils = require_utils();
      var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
      var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
      var G15_BCH = Utils.getBCHDigit(G15);
      exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
        const data = errorCorrectionLevel.bit << 3 | mask;
        let d = data << 10;
        while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
          d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
        }
        return (data << 10 | d) ^ G15_MASK;
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/numeric-data.js
  var require_numeric_data = __commonJS({
    "../../node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
      init_globals();
      var Mode = require_mode();
      function NumericData(data) {
        this.mode = Mode.NUMERIC;
        this.data = data.toString();
      }
      NumericData.getBitsLength = function getBitsLength(length) {
        return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
      };
      NumericData.prototype.getLength = function getLength() {
        return this.data.length;
      };
      NumericData.prototype.getBitsLength = function getBitsLength() {
        return NumericData.getBitsLength(this.data.length);
      };
      NumericData.prototype.write = function write(bitBuffer) {
        let i, group, value;
        for (i = 0; i + 3 <= this.data.length; i += 3) {
          group = this.data.substr(i, 3);
          value = parseInt(group, 10);
          bitBuffer.put(value, 10);
        }
        const remainingNum = this.data.length - i;
        if (remainingNum > 0) {
          group = this.data.substr(i);
          value = parseInt(group, 10);
          bitBuffer.put(value, remainingNum * 3 + 1);
        }
      };
      module.exports = NumericData;
    }
  });

  // ../../node_modules/qrcode/lib/core/alphanumeric-data.js
  var require_alphanumeric_data = __commonJS({
    "../../node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
      init_globals();
      var Mode = require_mode();
      var ALPHA_NUM_CHARS = [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
        " ",
        "$",
        "%",
        "*",
        "+",
        "-",
        ".",
        "/",
        ":"
      ];
      function AlphanumericData(data) {
        this.mode = Mode.ALPHANUMERIC;
        this.data = data;
      }
      AlphanumericData.getBitsLength = function getBitsLength(length) {
        return 11 * Math.floor(length / 2) + 6 * (length % 2);
      };
      AlphanumericData.prototype.getLength = function getLength() {
        return this.data.length;
      };
      AlphanumericData.prototype.getBitsLength = function getBitsLength() {
        return AlphanumericData.getBitsLength(this.data.length);
      };
      AlphanumericData.prototype.write = function write(bitBuffer) {
        let i;
        for (i = 0; i + 2 <= this.data.length; i += 2) {
          let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
          value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
          bitBuffer.put(value, 11);
        }
        if (this.data.length % 2) {
          bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
        }
      };
      module.exports = AlphanumericData;
    }
  });

  // ../../node_modules/qrcode/lib/core/byte-data.js
  var require_byte_data = __commonJS({
    "../../node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
      init_globals();
      var Mode = require_mode();
      function ByteData(data) {
        this.mode = Mode.BYTE;
        if (typeof data === "string") {
          this.data = new TextEncoder().encode(data);
        } else {
          this.data = new Uint8Array(data);
        }
      }
      ByteData.getBitsLength = function getBitsLength(length) {
        return length * 8;
      };
      ByteData.prototype.getLength = function getLength() {
        return this.data.length;
      };
      ByteData.prototype.getBitsLength = function getBitsLength() {
        return ByteData.getBitsLength(this.data.length);
      };
      ByteData.prototype.write = function(bitBuffer) {
        for (let i = 0, l = this.data.length; i < l; i++) {
          bitBuffer.put(this.data[i], 8);
        }
      };
      module.exports = ByteData;
    }
  });

  // ../../node_modules/qrcode/lib/core/kanji-data.js
  var require_kanji_data = __commonJS({
    "../../node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
      init_globals();
      var Mode = require_mode();
      var Utils = require_utils();
      function KanjiData(data) {
        this.mode = Mode.KANJI;
        this.data = data;
      }
      KanjiData.getBitsLength = function getBitsLength(length) {
        return length * 13;
      };
      KanjiData.prototype.getLength = function getLength() {
        return this.data.length;
      };
      KanjiData.prototype.getBitsLength = function getBitsLength() {
        return KanjiData.getBitsLength(this.data.length);
      };
      KanjiData.prototype.write = function(bitBuffer) {
        let i;
        for (i = 0; i < this.data.length; i++) {
          let value = Utils.toSJIS(this.data[i]);
          if (value >= 33088 && value <= 40956) {
            value -= 33088;
          } else if (value >= 57408 && value <= 60351) {
            value -= 49472;
          } else {
            throw new Error(
              "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
            );
          }
          value = (value >>> 8 & 255) * 192 + (value & 255);
          bitBuffer.put(value, 13);
        }
      };
      module.exports = KanjiData;
    }
  });

  // ../../node_modules/dijkstrajs/dijkstra.js
  var require_dijkstra = __commonJS({
    "../../node_modules/dijkstrajs/dijkstra.js"(exports, module) {
      "use strict";
      init_globals();
      var dijkstra = {
        single_source_shortest_paths: function(graph, s, d) {
          var predecessors = {};
          var costs = {};
          costs[s] = 0;
          var open = dijkstra.PriorityQueue.make();
          open.push(s, 0);
          var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
          while (!open.empty()) {
            closest = open.pop();
            u = closest.value;
            cost_of_s_to_u = closest.cost;
            adjacent_nodes = graph[u] || {};
            for (v in adjacent_nodes) {
              if (adjacent_nodes.hasOwnProperty(v)) {
                cost_of_e = adjacent_nodes[v];
                cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
                cost_of_s_to_v = costs[v];
                first_visit = typeof costs[v] === "undefined";
                if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                  costs[v] = cost_of_s_to_u_plus_cost_of_e;
                  open.push(v, cost_of_s_to_u_plus_cost_of_e);
                  predecessors[v] = u;
                }
              }
            }
          }
          if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
            var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
            throw new Error(msg);
          }
          return predecessors;
        },
        extract_shortest_path_from_predecessor_list: function(predecessors, d) {
          var nodes = [];
          var u = d;
          var predecessor;
          while (u) {
            nodes.push(u);
            predecessor = predecessors[u];
            u = predecessors[u];
          }
          nodes.reverse();
          return nodes;
        },
        find_path: function(graph, s, d) {
          var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
          return dijkstra.extract_shortest_path_from_predecessor_list(
            predecessors,
            d
          );
        },
        /**
         * A very naive priority queue implementation.
         */
        PriorityQueue: {
          make: function(opts) {
            var T = dijkstra.PriorityQueue, t = {}, key;
            opts = opts || {};
            for (key in T) {
              if (T.hasOwnProperty(key)) {
                t[key] = T[key];
              }
            }
            t.queue = [];
            t.sorter = opts.sorter || T.default_sorter;
            return t;
          },
          default_sorter: function(a, b) {
            return a.cost - b.cost;
          },
          /**
           * Add a new item to the queue and ensure the highest priority element
           * is at the front of the queue.
           */
          push: function(value, cost) {
            var item = { value, cost };
            this.queue.push(item);
            this.queue.sort(this.sorter);
          },
          /**
           * Return the highest priority element in the queue.
           */
          pop: function() {
            return this.queue.shift();
          },
          empty: function() {
            return this.queue.length === 0;
          }
        }
      };
      if (typeof module !== "undefined") {
        module.exports = dijkstra;
      }
    }
  });

  // ../../node_modules/qrcode/lib/core/segments.js
  var require_segments = __commonJS({
    "../../node_modules/qrcode/lib/core/segments.js"(exports) {
      init_globals();
      var Mode = require_mode();
      var NumericData = require_numeric_data();
      var AlphanumericData = require_alphanumeric_data();
      var ByteData = require_byte_data();
      var KanjiData = require_kanji_data();
      var Regex = require_regex();
      var Utils = require_utils();
      var dijkstra = require_dijkstra();
      function getStringByteLength(str) {
        return unescape(encodeURIComponent(str)).length;
      }
      function getSegments(regex, mode, str) {
        const segments = [];
        let result;
        while ((result = regex.exec(str)) !== null) {
          segments.push({
            data: result[0],
            index: result.index,
            mode,
            length: result[0].length
          });
        }
        return segments;
      }
      function getSegmentsFromString(dataStr) {
        const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
        const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
        let byteSegs;
        let kanjiSegs;
        if (Utils.isKanjiModeEnabled()) {
          byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
          kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
        } else {
          byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
          kanjiSegs = [];
        }
        const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
        return segs.sort(function(s1, s2) {
          return s1.index - s2.index;
        }).map(function(obj) {
          return {
            data: obj.data,
            mode: obj.mode,
            length: obj.length
          };
        });
      }
      function getSegmentBitsLength(length, mode) {
        switch (mode) {
          case Mode.NUMERIC:
            return NumericData.getBitsLength(length);
          case Mode.ALPHANUMERIC:
            return AlphanumericData.getBitsLength(length);
          case Mode.KANJI:
            return KanjiData.getBitsLength(length);
          case Mode.BYTE:
            return ByteData.getBitsLength(length);
        }
      }
      function mergeSegments(segs) {
        return segs.reduce(function(acc, curr) {
          const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
          if (prevSeg && prevSeg.mode === curr.mode) {
            acc[acc.length - 1].data += curr.data;
            return acc;
          }
          acc.push(curr);
          return acc;
        }, []);
      }
      function buildNodes(segs) {
        const nodes = [];
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          switch (seg.mode) {
            case Mode.NUMERIC:
              nodes.push([
                seg,
                { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
                { data: seg.data, mode: Mode.BYTE, length: seg.length }
              ]);
              break;
            case Mode.ALPHANUMERIC:
              nodes.push([
                seg,
                { data: seg.data, mode: Mode.BYTE, length: seg.length }
              ]);
              break;
            case Mode.KANJI:
              nodes.push([
                seg,
                { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
              ]);
              break;
            case Mode.BYTE:
              nodes.push([
                { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
              ]);
          }
        }
        return nodes;
      }
      function buildGraph(nodes, version) {
        const table = {};
        const graph = { start: {} };
        let prevNodeIds = ["start"];
        for (let i = 0; i < nodes.length; i++) {
          const nodeGroup = nodes[i];
          const currentNodeIds = [];
          for (let j = 0; j < nodeGroup.length; j++) {
            const node = nodeGroup[j];
            const key = "" + i + j;
            currentNodeIds.push(key);
            table[key] = { node, lastCount: 0 };
            graph[key] = {};
            for (let n = 0; n < prevNodeIds.length; n++) {
              const prevNodeId = prevNodeIds[n];
              if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
                graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
                table[prevNodeId].lastCount += node.length;
              } else {
                if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
                graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
              }
            }
          }
          prevNodeIds = currentNodeIds;
        }
        for (let n = 0; n < prevNodeIds.length; n++) {
          graph[prevNodeIds[n]].end = 0;
        }
        return { map: graph, table };
      }
      function buildSingleSegment(data, modesHint) {
        let mode;
        const bestMode = Mode.getBestModeForData(data);
        mode = Mode.from(modesHint, bestMode);
        if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
          throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
        }
        if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
          mode = Mode.BYTE;
        }
        switch (mode) {
          case Mode.NUMERIC:
            return new NumericData(data);
          case Mode.ALPHANUMERIC:
            return new AlphanumericData(data);
          case Mode.KANJI:
            return new KanjiData(data);
          case Mode.BYTE:
            return new ByteData(data);
        }
      }
      exports.fromArray = function fromArray(array) {
        return array.reduce(function(acc, seg) {
          if (typeof seg === "string") {
            acc.push(buildSingleSegment(seg, null));
          } else if (seg.data) {
            acc.push(buildSingleSegment(seg.data, seg.mode));
          }
          return acc;
        }, []);
      };
      exports.fromString = function fromString(data, version) {
        const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
        const nodes = buildNodes(segs);
        const graph = buildGraph(nodes, version);
        const path = dijkstra.find_path(graph.map, "start", "end");
        const optimizedSegs = [];
        for (let i = 1; i < path.length - 1; i++) {
          optimizedSegs.push(graph.table[path[i]].node);
        }
        return exports.fromArray(mergeSegments(optimizedSegs));
      };
      exports.rawSplit = function rawSplit(data) {
        return exports.fromArray(
          getSegmentsFromString(data, Utils.isKanjiModeEnabled())
        );
      };
    }
  });

  // ../../node_modules/qrcode/lib/core/qrcode.js
  var require_qrcode = __commonJS({
    "../../node_modules/qrcode/lib/core/qrcode.js"(exports) {
      init_globals();
      var Utils = require_utils();
      var ECLevel = require_error_correction_level();
      var BitBuffer = require_bit_buffer();
      var BitMatrix = require_bit_matrix();
      var AlignmentPattern = require_alignment_pattern();
      var FinderPattern = require_finder_pattern();
      var MaskPattern = require_mask_pattern();
      var ECCode = require_error_correction_code();
      var ReedSolomonEncoder = require_reed_solomon_encoder();
      var Version = require_version();
      var FormatInfo = require_format_info();
      var Mode = require_mode();
      var Segments = require_segments();
      function setupFinderPattern(matrix, version) {
        const size = matrix.size;
        const pos = FinderPattern.getPositions(version);
        for (let i = 0; i < pos.length; i++) {
          const row = pos[i][0];
          const col = pos[i][1];
          for (let r = -1; r <= 7; r++) {
            if (row + r <= -1 || size <= row + r) continue;
            for (let c = -1; c <= 7; c++) {
              if (col + c <= -1 || size <= col + c) continue;
              if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
                matrix.set(row + r, col + c, true, true);
              } else {
                matrix.set(row + r, col + c, false, true);
              }
            }
          }
        }
      }
      function setupTimingPattern(matrix) {
        const size = matrix.size;
        for (let r = 8; r < size - 8; r++) {
          const value = r % 2 === 0;
          matrix.set(r, 6, value, true);
          matrix.set(6, r, value, true);
        }
      }
      function setupAlignmentPattern(matrix, version) {
        const pos = AlignmentPattern.getPositions(version);
        for (let i = 0; i < pos.length; i++) {
          const row = pos[i][0];
          const col = pos[i][1];
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
                matrix.set(row + r, col + c, true, true);
              } else {
                matrix.set(row + r, col + c, false, true);
              }
            }
          }
        }
      }
      function setupVersionInfo(matrix, version) {
        const size = matrix.size;
        const bits = Version.getEncodedBits(version);
        let row, col, mod;
        for (let i = 0; i < 18; i++) {
          row = Math.floor(i / 3);
          col = i % 3 + size - 8 - 3;
          mod = (bits >> i & 1) === 1;
          matrix.set(row, col, mod, true);
          matrix.set(col, row, mod, true);
        }
      }
      function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
        const size = matrix.size;
        const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
        let i, mod;
        for (i = 0; i < 15; i++) {
          mod = (bits >> i & 1) === 1;
          if (i < 6) {
            matrix.set(i, 8, mod, true);
          } else if (i < 8) {
            matrix.set(i + 1, 8, mod, true);
          } else {
            matrix.set(size - 15 + i, 8, mod, true);
          }
          if (i < 8) {
            matrix.set(8, size - i - 1, mod, true);
          } else if (i < 9) {
            matrix.set(8, 15 - i - 1 + 1, mod, true);
          } else {
            matrix.set(8, 15 - i - 1, mod, true);
          }
        }
        matrix.set(size - 8, 8, 1, true);
      }
      function setupData(matrix, data) {
        const size = matrix.size;
        let inc = -1;
        let row = size - 1;
        let bitIndex = 7;
        let byteIndex = 0;
        for (let col = size - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          while (true) {
            for (let c = 0; c < 2; c++) {
              if (!matrix.isReserved(row, col - c)) {
                let dark = false;
                if (byteIndex < data.length) {
                  dark = (data[byteIndex] >>> bitIndex & 1) === 1;
                }
                matrix.set(row, col - c, dark);
                bitIndex--;
                if (bitIndex === -1) {
                  byteIndex++;
                  bitIndex = 7;
                }
              }
            }
            row += inc;
            if (row < 0 || size <= row) {
              row -= inc;
              inc = -inc;
              break;
            }
          }
        }
      }
      function createData(version, errorCorrectionLevel, segments) {
        const buffer = new BitBuffer();
        segments.forEach(function(data) {
          buffer.put(data.mode.bit, 4);
          buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
          data.write(buffer);
        });
        const totalCodewords = Utils.getSymbolTotalCodewords(version);
        const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
        const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
        if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
          buffer.put(0, 4);
        }
        while (buffer.getLengthInBits() % 8 !== 0) {
          buffer.putBit(0);
        }
        const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
        for (let i = 0; i < remainingByte; i++) {
          buffer.put(i % 2 ? 17 : 236, 8);
        }
        return createCodewords(buffer, version, errorCorrectionLevel);
      }
      function createCodewords(bitBuffer, version, errorCorrectionLevel) {
        const totalCodewords = Utils.getSymbolTotalCodewords(version);
        const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
        const dataTotalCodewords = totalCodewords - ecTotalCodewords;
        const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
        const blocksInGroup2 = totalCodewords % ecTotalBlocks;
        const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
        const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
        const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
        const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
        const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
        const rs = new ReedSolomonEncoder(ecCount);
        let offset = 0;
        const dcData = new Array(ecTotalBlocks);
        const ecData = new Array(ecTotalBlocks);
        let maxDataSize = 0;
        const buffer = new Uint8Array(bitBuffer.buffer);
        for (let b = 0; b < ecTotalBlocks; b++) {
          const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
          dcData[b] = buffer.slice(offset, offset + dataSize);
          ecData[b] = rs.encode(dcData[b]);
          offset += dataSize;
          maxDataSize = Math.max(maxDataSize, dataSize);
        }
        const data = new Uint8Array(totalCodewords);
        let index = 0;
        let i, r;
        for (i = 0; i < maxDataSize; i++) {
          for (r = 0; r < ecTotalBlocks; r++) {
            if (i < dcData[r].length) {
              data[index++] = dcData[r][i];
            }
          }
        }
        for (i = 0; i < ecCount; i++) {
          for (r = 0; r < ecTotalBlocks; r++) {
            data[index++] = ecData[r][i];
          }
        }
        return data;
      }
      function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
        let segments;
        if (Array.isArray(data)) {
          segments = Segments.fromArray(data);
        } else if (typeof data === "string") {
          let estimatedVersion = version;
          if (!estimatedVersion) {
            const rawSegments = Segments.rawSplit(data);
            estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
          }
          segments = Segments.fromString(data, estimatedVersion || 40);
        } else {
          throw new Error("Invalid data");
        }
        const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
        if (!bestVersion) {
          throw new Error("The amount of data is too big to be stored in a QR Code");
        }
        if (!version) {
          version = bestVersion;
        } else if (version < bestVersion) {
          throw new Error(
            "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
          );
        }
        const dataBits = createData(version, errorCorrectionLevel, segments);
        const moduleCount = Utils.getSymbolSize(version);
        const modules = new BitMatrix(moduleCount);
        setupFinderPattern(modules, version);
        setupTimingPattern(modules);
        setupAlignmentPattern(modules, version);
        setupFormatInfo(modules, errorCorrectionLevel, 0);
        if (version >= 7) {
          setupVersionInfo(modules, version);
        }
        setupData(modules, dataBits);
        if (isNaN(maskPattern)) {
          maskPattern = MaskPattern.getBestMask(
            modules,
            setupFormatInfo.bind(null, modules, errorCorrectionLevel)
          );
        }
        MaskPattern.applyMask(maskPattern, modules);
        setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
        return {
          modules,
          version,
          errorCorrectionLevel,
          maskPattern,
          segments
        };
      }
      exports.create = function create(data, options) {
        if (typeof data === "undefined" || data === "") {
          throw new Error("No input text");
        }
        let errorCorrectionLevel = ECLevel.M;
        let version;
        let mask;
        if (typeof options !== "undefined") {
          errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
          version = Version.from(options.version);
          mask = MaskPattern.from(options.maskPattern);
          if (options.toSJISFunc) {
            Utils.setToSJISFunction(options.toSJISFunc);
          }
        }
        return createSymbol(data, version, errorCorrectionLevel, mask);
      };
    }
  });

  // ../../node_modules/qrcode/lib/renderer/utils.js
  var require_utils2 = __commonJS({
    "../../node_modules/qrcode/lib/renderer/utils.js"(exports) {
      init_globals();
      function hex2rgba(hex) {
        if (typeof hex === "number") {
          hex = hex.toString();
        }
        if (typeof hex !== "string") {
          throw new Error("Color should be defined as hex string");
        }
        let hexCode = hex.slice().replace("#", "").split("");
        if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
          throw new Error("Invalid hex color: " + hex);
        }
        if (hexCode.length === 3 || hexCode.length === 4) {
          hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
            return [c, c];
          }));
        }
        if (hexCode.length === 6) hexCode.push("F", "F");
        const hexValue = parseInt(hexCode.join(""), 16);
        return {
          r: hexValue >> 24 & 255,
          g: hexValue >> 16 & 255,
          b: hexValue >> 8 & 255,
          a: hexValue & 255,
          hex: "#" + hexCode.slice(0, 6).join("")
        };
      }
      exports.getOptions = function getOptions(options) {
        if (!options) options = {};
        if (!options.color) options.color = {};
        const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
        const width = options.width && options.width >= 21 ? options.width : void 0;
        const scale = options.scale || 4;
        return {
          width,
          scale: width ? 4 : scale,
          margin,
          color: {
            dark: hex2rgba(options.color.dark || "#000000ff"),
            light: hex2rgba(options.color.light || "#ffffffff")
          },
          type: options.type,
          rendererOpts: options.rendererOpts || {}
        };
      };
      exports.getScale = function getScale(qrSize, opts) {
        return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
      };
      exports.getImageWidth = function getImageWidth(qrSize, opts) {
        const scale = exports.getScale(qrSize, opts);
        return Math.floor((qrSize + opts.margin * 2) * scale);
      };
      exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
        const size = qr.modules.size;
        const data = qr.modules.data;
        const scale = exports.getScale(size, opts);
        const symbolSize = Math.floor((size + opts.margin * 2) * scale);
        const scaledMargin = opts.margin * scale;
        const palette = [opts.color.light, opts.color.dark];
        for (let i = 0; i < symbolSize; i++) {
          for (let j = 0; j < symbolSize; j++) {
            let posDst = (i * symbolSize + j) * 4;
            let pxColor = opts.color.light;
            if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
              const iSrc = Math.floor((i - scaledMargin) / scale);
              const jSrc = Math.floor((j - scaledMargin) / scale);
              pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
            }
            imgData[posDst++] = pxColor.r;
            imgData[posDst++] = pxColor.g;
            imgData[posDst++] = pxColor.b;
            imgData[posDst] = pxColor.a;
          }
        }
      };
    }
  });

  // ../../node_modules/qrcode/lib/renderer/canvas.js
  var require_canvas = __commonJS({
    "../../node_modules/qrcode/lib/renderer/canvas.js"(exports) {
      init_globals();
      var Utils = require_utils2();
      function clearCanvas(ctx, canvas, size) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!canvas.style) canvas.style = {};
        canvas.height = size;
        canvas.width = size;
        canvas.style.height = size + "px";
        canvas.style.width = size + "px";
      }
      function getCanvasElement() {
        try {
          return document.createElement("canvas");
        } catch (e) {
          throw new Error("You need to specify a canvas element");
        }
      }
      exports.render = function render(qrData, canvas, options) {
        let opts = options;
        let canvasEl = canvas;
        if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
          opts = canvas;
          canvas = void 0;
        }
        if (!canvas) {
          canvasEl = getCanvasElement();
        }
        opts = Utils.getOptions(opts);
        const size = Utils.getImageWidth(qrData.modules.size, opts);
        const ctx = canvasEl.getContext("2d");
        const image = ctx.createImageData(size, size);
        Utils.qrToImageData(image.data, qrData, opts);
        clearCanvas(ctx, canvasEl, size);
        ctx.putImageData(image, 0, 0);
        return canvasEl;
      };
      exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
        let opts = options;
        if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
          opts = canvas;
          canvas = void 0;
        }
        if (!opts) opts = {};
        const canvasEl = exports.render(qrData, canvas, opts);
        const type = opts.type || "image/png";
        const rendererOpts = opts.rendererOpts || {};
        return canvasEl.toDataURL(type, rendererOpts.quality);
      };
    }
  });

  // ../../node_modules/qrcode/lib/renderer/svg-tag.js
  var require_svg_tag = __commonJS({
    "../../node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
      init_globals();
      var Utils = require_utils2();
      function getColorAttrib(color, attrib) {
        const alpha = color.a / 255;
        const str = attrib + '="' + color.hex + '"';
        return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
      }
      function svgCmd(cmd, x, y) {
        let str = cmd + x;
        if (typeof y !== "undefined") str += " " + y;
        return str;
      }
      function qrToPath(data, size, margin) {
        let path = "";
        let moveBy = 0;
        let newRow = false;
        let lineLength = 0;
        for (let i = 0; i < data.length; i++) {
          const col = Math.floor(i % size);
          const row = Math.floor(i / size);
          if (!col && !newRow) newRow = true;
          if (data[i]) {
            lineLength++;
            if (!(i > 0 && col > 0 && data[i - 1])) {
              path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
              moveBy = 0;
              newRow = false;
            }
            if (!(col + 1 < size && data[i + 1])) {
              path += svgCmd("h", lineLength);
              lineLength = 0;
            }
          } else {
            moveBy++;
          }
        }
        return path;
      }
      exports.render = function render(qrData, options, cb) {
        const opts = Utils.getOptions(options);
        const size = qrData.modules.size;
        const data = qrData.modules.data;
        const qrcodesize = size + opts.margin * 2;
        const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
        const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
        const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
        const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
        const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
        if (typeof cb === "function") {
          cb(null, svgTag);
        }
        return svgTag;
      };
    }
  });

  // ../../node_modules/qrcode/lib/browser.js
  var require_browser = __commonJS({
    "../../node_modules/qrcode/lib/browser.js"(exports) {
      init_globals();
      var canPromise = require_can_promise();
      var QRCode2 = require_qrcode();
      var CanvasRenderer = require_canvas();
      var SvgRenderer = require_svg_tag();
      function renderCanvas(renderFunc, canvas, text, opts, cb) {
        const args = [].slice.call(arguments, 1);
        const argsNum = args.length;
        const isLastArgCb = typeof args[argsNum - 1] === "function";
        if (!isLastArgCb && !canPromise()) {
          throw new Error("Callback required as last argument");
        }
        if (isLastArgCb) {
          if (argsNum < 2) {
            throw new Error("Too few arguments provided");
          }
          if (argsNum === 2) {
            cb = text;
            text = canvas;
            canvas = opts = void 0;
          } else if (argsNum === 3) {
            if (canvas.getContext && typeof cb === "undefined") {
              cb = opts;
              opts = void 0;
            } else {
              cb = opts;
              opts = text;
              text = canvas;
              canvas = void 0;
            }
          }
        } else {
          if (argsNum < 1) {
            throw new Error("Too few arguments provided");
          }
          if (argsNum === 1) {
            text = canvas;
            canvas = opts = void 0;
          } else if (argsNum === 2 && !canvas.getContext) {
            opts = text;
            text = canvas;
            canvas = void 0;
          }
          return new Promise(function(resolve2, reject) {
            try {
              const data = QRCode2.create(text, opts);
              resolve2(renderFunc(data, canvas, opts));
            } catch (e) {
              reject(e);
            }
          });
        }
        try {
          const data = QRCode2.create(text, opts);
          cb(null, renderFunc(data, canvas, opts));
        } catch (e) {
          cb(e);
        }
      }
      exports.create = QRCode2.create;
      exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
      exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
      exports.toString = renderCanvas.bind(null, function(data, _, opts) {
        return SvgRenderer.render(data, opts);
      });
    }
  });

  // ../../electron/qishui/qishui-auth-v6.js
  var require_qishui_auth_v6 = __commonJS({
    "../../electron/qishui/qishui-auth-v6.js"(exports, module) {
      "use strict";
      init_globals();
      var crypto = (init_crypto(), __toCommonJS(crypto_exports));
      var fs = (init_fs(), __toCommonJS(fs_exports));
      var http = (init_http(), __toCommonJS(http_exports));
      var os = (init_os(), __toCommonJS(os_exports));
      var path = (init_path(), __toCommonJS(path_exports));
      var { BrowserWindow: BrowserWindow2, app: app2, session: session2 } = (init_electron(), __toCommonJS(electron_exports));
      var QRCode2 = require_browser();
      var API_BASE2 = "https://api.qishui.com";
      var AID2 = "386088";
      var APP_VERSION2 = "3.5.2";
      var SDK_VERSION2 = "2.4.13";
      var VERIFY_SDK_VERSION2 = "1.0.29";
      var SECURE_SDK_VERSION2 = "3.3.5";
      var BDMS_VERSION2 = "1.0.0.41";
      var AUTH_PARTITION = "persist:folia-qishui-auth-v6";
      var OFFICIAL_BDMS_URL = "https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js";
      var UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36";
      var ASSET_DIR = path.join(__foliaDirname, "qishui-auth-v6");
      var ASSETS = /* @__PURE__ */ new Map([
        ["security_seed.html", "text/html; charset=utf-8"],
        ["security_host.html", "text/html; charset=utf-8"],
        ["react.js", "text/javascript; charset=utf-8"],
        ["react-dom.js", "text/javascript; charset=utf-8"],
        ["sdk-glue.js", "text/javascript; charset=utf-8"],
        ["bdms.js", "text/javascript; charset=utf-8"]
      ]);
      var bdmsNative = null;
      var bdmsNativeInited = false;
      try {
        const bdmsPath = path.join(ASSET_DIR, "bdms.node");
        if (fs.existsSync(bdmsPath)) bdmsNative = __require(bdmsPath);
      } catch (_) {
        bdmsNative = null;
      }
      function nativeHttpRequest(targetUrl, method, headers, body, timeoutMs) {
        return new Promise((resolve2, reject) => {
          let u;
          try {
            u = new URL(targetUrl);
          } catch (e) {
            return reject(e);
          }
          const isHttps = u.protocol === "https:";
          const lib = isHttps ? (init_https(), __toCommonJS(https_exports)) : (init_http(), __toCommonJS(http_exports));
          const reqHeaders = {};
          for (const [k, v] of Object.entries(headers || {})) {
            if (v != null) reqHeaders[k] = String(v);
          }
          if (body != null && !("content-length" in reqHeaders) && !("Content-Length" in reqHeaders)) {
            reqHeaders["Content-Length"] = buffer_default.byteLength(String(body));
          }
          const req = lib.request({
            hostname: u.hostname,
            port: u.port || (isHttps ? 443 : 80),
            path: u.pathname + u.search,
            method: String(method || "GET").toUpperCase(),
            headers: reqHeaders
          }, (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (c) => {
              data += c;
            });
            res.on("end", () => resolve2({ status: res.statusCode, body: data, headers: res.headers }));
          });
          req.on("error", reject);
          req.setTimeout(Number(timeoutMs) || 2e4, () => {
            req.destroy(new Error("native http timeout"));
          });
          if (body != null) req.write(String(body));
          req.end();
        });
      }
      var getConfig2 = null;
      var updateConfig2 = null;
      var runtime2 = null;
      function configure2(hooks) {
        getConfig2 = hooks && hooks.getConfig;
        updateConfig2 = hooks && hooks.updateConfig;
      }
      function randomDigits2(length, firstMax = 9) {
        let value = String(crypto.randomInt(1, Math.max(2, firstMax + 1)));
        while (value.length < length) value += String(crypto.randomInt(0, 10));
        return value;
      }
      function ensureIdentity2() {
        if (typeof getConfig2 !== "function" || typeof updateConfig2 !== "function") {
          throw new Error("Qishui V6 auth runtime is not configured");
        }
        const config = getConfig2();
        const patch = {};
        if (!config.deviceId) patch.deviceId = randomDigits2(16, 8);
        if (!config.installId) patch.installId = randomDigits2(15, 8);
        if (!config.verifyPortraitId) patch.verifyPortraitId = crypto.randomUUID() + ".login";
        if (!config.computerName) patch.computerName = os.hostname() || "Windows-PC";
        if (Object.keys(patch).length) updateConfig2(patch);
        const current = getConfig2();
        return {
          deviceId: String(current.deviceId),
          installId: String(current.installId),
          verifyPortraitId: String(current.verifyPortraitId),
          computerName: String(current.computerName || "Windows-PC")
        };
      }
      function delay2(ms) {
        return new Promise((resolve2) => setTimeout(resolve2, ms));
      }
      function normalizeBizParams2(value) {
        if (!value) return {};
        let source = value;
        if (typeof source === "string") {
          try {
            source = JSON.parse(source);
          } catch (_) {
            const parsed = new URLSearchParams(source);
            return Object.fromEntries(parsed.entries());
          }
        }
        if (!source || typeof source !== "object" || Array.isArray(source)) {
          throw new Error("二次验证 biz_params 格式无效");
        }
        const result = {};
        for (const [key, item] of Object.entries(source)) {
          if (item == null) continue;
          result[String(key)] = typeof item === "object" ? JSON.stringify(item) : String(item);
        }
        return result;
      }
      function mergeDecision2(envelope) {
        const data = envelope && envelope.data && typeof envelope.data === "object" ? envelope.data : {};
        const decision = { ...envelope || {}, ...data };
        delete decision.data;
        return decision;
      }
      function officialScanUrl2(indexUrl, computerName) {
        const source = new URL(String(indexUrl || ""));
        const token = source.searchParams.get("token");
        if (!token) throw new Error("qrcode_index_url 缺少 token");
        const target = new URL("https://bff-pc.qishui.com/light/invoke/scan_login");
        target.searchParams.set("token", token);
        target.searchParams.set("os", "Windows");
        target.searchParams.set("computer_name", computerName || "Windows-PC");
        return target.toString().replace(/\+/g, "%20");
      }
      function parseCookieString2(raw) {
        const result = {};
        String(raw || "").split(";").forEach((pair) => {
          const index = pair.indexOf("=");
          if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
        });
        return result;
      }
      function buildCookieString2(values) {
        return Object.entries(values).filter(([name]) => name).map(([name, value]) => name + "=" + value).join("; ");
      }
      var QishuiAuthRuntime2 = class {
        constructor() {
          this.window = null;
          this.authSession = null;
          this.assetServer = null;
          this.assetBase = "";
          this.assetToken = crypto.randomBytes(18).toString("hex");
          this.msToken = "";
          this.browserInfo = null;
          this.lastPassportRequest = null;
          this.lastApiRequest = null;
          this.initializing = null;
          this.destroying = false;
          this.mfaNetworkLog = [];
        }
        async initialize() {
          if (this.window && !this.window.isDestroyed() && this.browserInfo && this.msToken) return true;
          if (this.initializing) return this.initializing;
          this.initializing = this._initialize().finally(() => {
            this.initializing = null;
          });
          return this.initializing;
        }
        async _startAssetServer() {
          if (this.assetServer) return;
          this.assetServer = http.createServer((request3, response) => {
            try {
              const url = new URL(request3.url, "http://127.0.0.1");
              const prefix = "/" + this.assetToken + "/";
              if (!url.pathname.startsWith(prefix)) {
                response.writeHead(404).end("not found");
                return;
              }
              const name = url.pathname.slice(prefix.length);
              const type = ASSETS.get(name);
              if (!type) {
                response.writeHead(404).end("not found");
                return;
              }
              const file = path.join(ASSET_DIR, name);
              if (!fs.existsSync(file)) {
                response.writeHead(500).end("missing auth asset");
                return;
              }
              response.writeHead(200, {
                "Content-Type": type,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
              });
              fs.createReadStream(file).pipe(response);
            } catch (_) {
              response.writeHead(500).end("asset error");
            }
          });
          await new Promise((resolve2, reject) => {
            this.assetServer.once("error", reject);
            this.assetServer.listen(0, "127.0.0.1", resolve2);
          });
          const address = this.assetServer.address();
          this.assetBase = `http://127.0.0.1:${address.port}/${this.assetToken}/`;
        }
        _installSessionHooks() {
          const authSession = this.authSession;
          authSession.webRequest.onBeforeRequest(
            { urls: [OFFICIAL_BDMS_URL] },
            (_details, callback) => callback({ redirectURL: this.assetBase + "bdms.js" })
          );
          authSession.webRequest.onHeadersReceived(
            { urls: ["https://api.qishui.com/*", "https://verify.zijieapi.com/*", "https://auth.zijieapi.com/*"] },
            (details, callback) => {
              const headers = { ...details.responseHeaders || {} };
              let origin = "*";
              try {
                origin = new URL(this.assetBase).origin;
              } catch (_) {
              }
              headers["Access-Control-Allow-Origin"] = [origin];
              headers["Access-Control-Allow-Credentials"] = ["true"];
              headers["Access-Control-Allow-Headers"] = ["*"];
              headers["Access-Control-Allow-Methods"] = ["GET,POST,PUT,PATCH,DELETE,OPTIONS"];
              headers["Access-Control-Expose-Headers"] = ["*"];
              callback({ responseHeaders: headers });
            }
          );
          authSession.webRequest.onBeforeSendHeaders(
            { urls: ["https://api.qishui.com/*", "https://api5-lq.qishui.com/*"] },
            (details, callback) => {
              const request3 = {
                method: details.method,
                url: details.url,
                requestHeaders: details.requestHeaders
              };
              this.lastApiRequest = request3;
              if (/\/passport\//i.test(details.url)) this.lastPassportRequest = request3;
              if (__foliaProcessEnv.QISHUI_DEBUG_SIGNED === "1" && /\/luna\//i.test(details.url)) {
                console.warn("[QishuiSignedHeaders]", details.requestHeaders && details.requestHeaders.Cookie ? "cookie" : "no-cookie");
              }
              callback({ requestHeaders: details.requestHeaders });
            }
          );
          const mfaUrls = ["https://api.qishui.com/passport/*", "https://verify.zijieapi.com/passport/*"];
          authSession.webRequest.onCompleted({ urls: mfaUrls }, (details) => {
            this.mfaNetworkLog.push({ at: Date.now(), method: details.method, endpoint: this.safeEndpoint(details.url), statusCode: details.statusCode });
            if (this.mfaNetworkLog.length > 100) this.mfaNetworkLog.shift();
          });
          authSession.webRequest.onErrorOccurred({ urls: mfaUrls }, (details) => {
            this.mfaNetworkLog.push({ at: Date.now(), method: details.method, endpoint: this.safeEndpoint(details.url), error: details.error });
            if (this.mfaNetworkLog.length > 100) this.mfaNetworkLog.shift();
          });
        }
        safeEndpoint(rawUrl) {
          try {
            const value = new URL(rawUrl);
            return value.origin + value.pathname;
          } catch (_) {
            return String(rawUrl || "").split("?")[0];
          }
        }
        async _initialize() {
          if (!app2.isReady()) await app2.whenReady();
          ensureIdentity2();
          await this._startAssetServer();
          this.authSession = session2.fromPartition(AUTH_PARTITION);
          this._installSessionHooks();
          this.window = new BrowserWindow2({
            show: false,
            width: 980,
            height: 760,
            minWidth: 760,
            minHeight: 600,
            title: "汽水音乐安全验证",
            autoHideMenuBar: true,
            backgroundColor: "#ffffff",
            webPreferences: {
              partition: AUTH_PARTITION,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: false,
              backgroundThrottling: false
            }
          });
          this.window.setMenuBarVisibility(false);
          this.window.webContents.setUserAgent(UA2);
          this.window.on("close", (event) => {
            if (this.destroying) return;
            event.preventDefault();
            this.window.webContents.executeJavaScript(
              "window.__qishuiCancelSecondVerify && window.__qishuiCancelSecondVerify()"
            ).catch(() => {
            });
            this.window.hide();
          });
          await this.window.loadURL(this.assetBase + "security_seed.html");
          let storedToken = await this.window.webContents.executeJavaScript(
            `localStorage.getItem('xmsty') || localStorage.getItem('xmst') || ''`,
            true
          );
          if (!/^[A-Za-z0-9_-]{118}==$/.test(String(storedToken || ""))) {
            storedToken = crypto.randomBytes(88).toString("base64url") + "==";
          }
          this.msToken = String(storedToken);
          await this.window.webContents.executeJavaScript(
            `localStorage.setItem('xmst', ${JSON.stringify(this.msToken)});
       localStorage.setItem('xmsty', ${JSON.stringify(this.msToken)}); true`,
            true
          );
          await this.window.loadURL(this.assetBase + "security_host.html");
          await this.waitForBdms();
          this.browserInfo = await this.window.webContents.executeJavaScript("window.__qishuiBrowserInfo()", true);
          updateConfig2({ msToken: this.msToken });
          return true;
        }
        async waitForBdms(timeoutMs = 2e4) {
          const deadline = Date.now() + timeoutMs;
          let last = null;
          while (Date.now() < deadline) {
            last = await this.window.webContents.executeJavaScript(`({
        glue: window._sdkGlueVersionMap && window._sdkGlueVersionMap.sdkGlueVersion,
        bdms: window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion,
        loaded: Boolean(window.bdms)
      })`);
            if (last && last.loaded && last.bdms) return last;
            await delay2(100);
          }
          throw new Error("汽水安全组件初始化超时：bdms 1.0.0.41 未就绪");
        }
        commonParams(identity) {
          return {
            passport_jssdk_version: SDK_VERSION2,
            passport_jssdk_type: "normal",
            is_from_ttaccountsdk: "1",
            aid: AID2,
            language: "zh",
            account_sdk_source: "web",
            p_js_v: SDK_VERSION2,
            p_js_t: "pro",
            p_zt: SECURE_SDK_VERSION2,
            p_ver: VERIFY_SDK_VERSION2,
            request_host: "app%3A%2F%2Fresources",
            p_bd: BDMS_VERSION2,
            biz_trace_id: crypto.randomBytes(4).toString("hex"),
            is_new_login: "1",
            is_from_iesaccountsaas: "1",
            device_id: identity.deviceId,
            install_id: identity.installId,
            did: identity.deviceId,
            iid: identity.installId,
            device_platform: "PC",
            version_code: APP_VERSION2,
            account_sdk_source_info: String(this.browserInfo.encrypted),
            msToken: this.msToken
          };
        }
        requestHeaders(identity, bizTraceId) {
          const traceId = crypto.randomBytes(16).toString("hex");
          return {
            Accept: "application/json, text/javascript",
            "User-Agent": UA2,
            "x-tt-passport-verify-portrait": identity.verifyPortraitId,
            "x-tt-passport-trace-id": bizTraceId,
            "x-tt-trace-id": `00-${traceId}-${traceId.slice(0, 16)}-01`
          };
        }
        async request(method, pathname, params, data) {
          await this.initialize();
          const identity = ensureIdentity2();
          const query = { ...this.commonParams(identity), ...params || {} };
          const url = new URL(pathname, API_BASE2);
          for (const [name, value] of Object.entries(query)) {
            if (value != null) url.searchParams.set(name, String(value));
          }
          const headers = this.requestHeaders(identity, query.biz_trace_id);
          let body = null;
          if (data != null) {
            body = new URLSearchParams();
            for (const [name, value] of Object.entries(data)) {
              if (value != null) body.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
            }
            body = body.toString();
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            headers["x-ss-stub"] = crypto.createHash("md5").update(body).digest("hex").toUpperCase();
          }
          const payload = {
            method: String(method || "GET").toUpperCase(),
            url: url.toString(),
            headers,
            body,
            timeout: 3e4
          };
          const response = await this.window.webContents.executeJavaScript(
            `window.__qishuiRequest(${JSON.stringify(payload)})`,
            true
          );
          if (!response || response.status < 200 || response.status >= 400) {
            throw new Error(`汽水登录接口 HTTP ${response && response.status || 0}: ${String(response && response.body || "").slice(0, 300)}`);
          }
          let envelope;
          try {
            envelope = JSON.parse(response.body || "{}");
          } catch (_) {
            throw new Error("汽水登录接口返回了无效 JSON");
          }
          const signedUrl = String(this.lastPassportRequest && this.lastPassportRequest.url || "");
          let signedQuery;
          try {
            signedQuery = new URL(signedUrl).searchParams;
          } catch (_) {
            signedQuery = new URLSearchParams();
          }
          const aBogus = signedQuery.get("a_bogus") || "";
          const signedMsToken = signedQuery.get("msToken") || "";
          if (aBogus.length !== 44 || signedMsToken !== this.msToken) {
            throw new Error("汽水安全参数注入失败：a_bogus 或 msToken 缺失");
          }
          return envelope;
        }
        async syncSessionCookies(cookieText, targetUrl) {
          if (!this.authSession) return;
          const cookies = parseCookieString2(cookieText);
          if (!Object.keys(cookies).length) return;
          let url;
          try {
            url = new URL(targetUrl);
          } catch (_) {
            return;
          }
          const cookieUrl = url.origin + "/";
          for (const [name, value] of Object.entries(cookies)) {
            if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
            try {
              await this.authSession.cookies.set({
                url: cookieUrl,
                name,
                value: String(value),
                path: "/",
                secure: url.protocol === "https:",
                sameSite: "no_restriction"
              });
            } catch (_) {
            }
          }
        }
        async requestOfficial(method, targetUrl, options = {}) {
          await this.initialize();
          const identity = ensureIdentity2();
          let url;
          try {
            url = new URL(String(targetUrl));
          } catch (_) {
            const error = new Error("汽水官方请求 URL 无效");
            error.code = "QISHUI_OFFICIAL_URL_INVALID";
            throw error;
          }
          if (!/^https:\/\/(?:api|api5-lq)\.qishui\.com$/i.test(url.origin)) {
            const error = new Error("汽水官方请求目标不受支持");
            error.code = "QISHUI_OFFICIAL_HOST_UNSUPPORTED";
            throw error;
          }
          if (url.searchParams.has("device_id")) url.searchParams.set("device_id", identity.deviceId);
          if (url.searchParams.has("iid")) url.searchParams.set("iid", identity.installId);
          if (url.searchParams.has("did")) url.searchParams.set("did", identity.deviceId);
          if (url.searchParams.has("fp")) url.searchParams.set("fp", identity.deviceId);
          if (this.msToken && !url.searchParams.has("msToken")) url.searchParams.set("msToken", this.msToken);
          await this.syncSessionCookies(options.cookie || "", url.toString());
          if (bdmsNative && !/\/(?:passport|ttwid)\//i.test(url.pathname || "")) {
            try {
              if (!bdmsNativeInited) {
                try {
                  bdmsNative.init({ deviceId: identity && identity.deviceId || randomDigits2(19) });
                } catch (_) {
                }
                bdmsNativeInited = true;
              }
              return await this.requestSignedNative(method, url, options);
            } catch (nativeErr) {
              if (__foliaProcessEnv.QISHUI_DEBUG_SIGNED === "1") {
                console.warn("[QishuiNativeSigned] 回退隐藏窗:", nativeErr && nativeErr.message);
              }
            }
          }
          const headers = { ...options.headers || {} };
          ["Cookie", "Host", "Content-Length", "Origin", "Referer", "User-Agent"].forEach((name) => {
            delete headers[name];
            delete headers[name.toLowerCase()];
          });
          const payload = {
            method: String(method || "GET").toUpperCase(),
            url: url.toString(),
            headers,
            body: options.body == null ? null : String(options.body),
            timeout: Number(options.timeoutMs) || 2e4,
            withCredentials: true
          };
          this.lastApiRequest = null;
          const response = await this.window.webContents.executeJavaScript(
            `window.__qishuiRequest(${JSON.stringify(payload)})`,
            true
          );
          if (!response || response.status < 200 || response.status >= 400) {
            const error = new Error(`汽水官方接口 HTTP ${response && response.status || 0}`);
            error.code = "QISHUI_OFFICIAL_HTTP_FAILED";
            error.statusCode = response && response.status || 0;
            throw error;
          }
          if (!String(response.body || "").trim()) {
            if (__foliaProcessEnv.QISHUI_DEBUG_SIGNED === "1") {
              let signedQuery = new URLSearchParams();
              try {
                signedQuery = new URL(String(this.lastApiRequest && this.lastApiRequest.url || url)).searchParams;
              } catch (_) {
              }
              console.warn("[QishuiSignedEmpty]", response.status, signedQuery.has("a_bogus") ? String(signedQuery.get("a_bogus") || "").length : 0, signedQuery.has("msToken"));
            }
            const error = new Error("汽水官方接口返回空响应");
            error.code = "QISHUI_OFFICIAL_EMPTY_RESPONSE";
            error.statusCode = response.status;
            throw error;
          }
          return {
            ...response,
            requestUrl: String(this.lastApiRequest && this.lastApiRequest.url || url.toString())
          };
        }
        // 用汽水原生 bdms.node 计算 X-Helios/X-Medusa 签名，主进程直接发请求。
        async requestSignedNative(method, url, options) {
          const targetUrl = url.toString();
          const ua = "LunaPC/" + APP_VERSION2;
          const isPost = String(method || "GET").toUpperCase() === "POST";
          const body = options.body == null ? null : String(options.body);
          const headerLines = ["user-agent\r\n" + ua];
          if (isPost && body) {
            const md5 = crypto.createHash("md5").update(body).digest("hex").toUpperCase();
            headerLines.push("X-SS-STUB\r\n" + md5);
          }
          const sig = bdmsNative.generateHttpSignatureHeaders(targetUrl, headerLines.join("\r\n"));
          const lines = String(sig).split("\r\n").filter((t) => t.trim());
          const extra = {};
          for (let i = 0; i + 1 < lines.length; i += 2) extra[lines[i]] = lines[i + 1];
          let cookieHeader = "";
          try {
            const authSession = session2.fromPartition(AUTH_PARTITION);
            const cookies = await authSession.cookies.get({ url: targetUrl });
            if (cookies && cookies.length) cookieHeader = cookies.map((c) => c.name + "=" + c.value).join("; ");
          } catch (_) {
          }
          const reqHeaders = { "user-agent": ua };
          if (isPost && body) reqHeaders["Content-Type"] = "application/json; charset=utf-8";
          if (cookieHeader) reqHeaders["cookie"] = cookieHeader;
          Object.assign(reqHeaders, extra);
          return await nativeHttpRequest(targetUrl, method, reqHeaders, body, Number(options.timeoutMs) || 2e4);
        }
        async getQrCode() {
          await this.initialize();
          const identity = ensureIdentity2();
          const envelope = await this.request("GET", "/passport/web/get_qrcode/", {
            next: API_BASE2,
            need_logo: "false",
            need_short_url: "false"
          });
          const data = envelope.data || {};
          if (envelope.message !== "success" || Number(data.error_code) !== 0) {
            throw new Error(`二维码生成失败：code=${data.error_code} ${data.description || envelope.message || ""}`);
          }
          const scanUrl = officialScanUrl2(data.qrcode_index_url, identity.computerName);
          const qrDataUrl = await QRCode2.toDataURL(scanUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 360,
            color: { dark: "#000000", light: "#ffffff" }
          });
          envelope.data = { ...data, qrcode: qrDataUrl, scan_url: scanUrl };
          return envelope;
        }
        async secondVerify(decision, identity) {
          this.mfaNetworkLog = [];
          this.window.setTitle("汽水音乐安全验证");
          this.window.setSize(980, 760);
          this.window.center();
          this.window.show();
          this.window.focus();
          try {
            return await this.window.webContents.executeJavaScript(
              `window.__qishuiSecondVerify(
          ${JSON.stringify(decision)},
          ${JSON.stringify({ generalParams: {
                device_id: identity.deviceId,
                install_id: identity.installId,
                did: identity.deviceId,
                iid: identity.installId,
                device_platform: "PC",
                version_code: APP_VERSION2
              } })}
        )`,
              true
            );
          } finally {
            if (this.window && !this.window.isDestroyed()) this.window.hide();
          }
        }
        async checkQrConnect(token) {
          await this.initialize();
          const identity = ensureIdentity2();
          const body = {
            need_logo: "false",
            need_short_url: "false",
            is_frontier: "true",
            token: String(token || ""),
            is_new_login: "1",
            next: API_BASE2
          };
          let envelope = await this.request("POST", "/passport/web/check_qrconnect/", {}, body);
          let data = envelope.data || {};
          if (Number(data.error_code) === 2046) {
            const decision = mergeDecision2(envelope);
            if (!decision.verify_portrait_id) decision.verify_portrait_id = identity.verifyPortraitId;
            const bizParams = normalizeBizParams2(decision.biz_params);
            const verified = await this.secondVerify(decision, identity);
            if (!verified || verified.status !== true) {
              const error = new Error(verified && verified.message || "二次验证未完成");
              error.code = "QISHUI_MFA_CANCELLED";
              throw error;
            }
            envelope = await this.request(
              "POST",
              "/passport/web/check_qrconnect/",
              { isResend: "true" },
              { ...body, ...bizParams }
            );
            data = envelope.data || {};
            if (Number(data.error_code) === 2046) {
              throw new Error("二次验证已通过，但服务端仍返回 2046；请重新刷新二维码");
            }
          }
          if (Number(data.error_code) === 0 && (String(data.status) === "3" || String(data.status) === "confirmed" || data.session_cookie)) {
            await this.persistSessionCookies(data.session_cookie || "");
          }
          return envelope;
        }
        async persistSessionCookies(sessionCookie) {
          const current = parseCookieString2(getConfig2().cookie || "");
          Object.assign(current, parseCookieString2(sessionCookie));
          const cookies = await this.authSession.cookies.get({});
          for (const cookie of cookies) {
            const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
            if (domain === "qishui.com" || domain.endsWith(".qishui.com")) {
              current[cookie.name] = cookie.value;
            }
          }
          updateConfig2({ cookie: buildCookieString2(current), msToken: this.msToken });
        }
        async clear() {
          if (this.authSession) {
            await this.authSession.clearStorageData({
              storages: ["cookies", "localstorage", "indexdb", "cachestorage", "serviceworkers"]
            });
            try {
              await this.authSession.flushStorageData();
            } catch (_) {
            }
          }
          this.destroying = true;
          if (this.window && !this.window.isDestroyed()) this.window.destroy();
          this.window = null;
          this.browserInfo = null;
          this.lastApiRequest = null;
          this.msToken = "";
          if (this.assetServer) await new Promise((resolve2) => this.assetServer.close(resolve2));
          this.assetServer = null;
          this.assetBase = "";
          this.assetToken = crypto.randomBytes(18).toString("hex");
          this.destroying = false;
        }
      };
      async function initSignEngine2() {
        if (!runtime2) runtime2 = new QishuiAuthRuntime2();
        return runtime2.initialize();
      }
      async function getQrCode2() {
        await initSignEngine2();
        return runtime2.getQrCode();
      }
      async function checkQrConnect2(token) {
        await initSignEngine2();
        return runtime2.checkQrConnect(token);
      }
      async function requestOfficial2(method, targetUrl, options) {
        if (!runtime2) runtime2 = new QishuiAuthRuntime2();
        return runtime2.requestOfficial(method, targetUrl, options || {});
      }
      async function clear2() {
        if (runtime2) {
          await runtime2.clear();
        } else {
          if (!app2.isReady()) await app2.whenReady();
          const authSession = session2.fromPartition(AUTH_PARTITION);
          await authSession.clearStorageData({
            storages: ["cookies", "localstorage", "indexdb", "cachestorage", "serviceworkers"]
          });
          try {
            await authSession.flushStorageData();
          } catch (_) {
          }
        }
        runtime2 = null;
      }
      async function destroyWindow() {
        const instance = runtime2;
        runtime2 = null;
        if (!instance) return;
        try {
          if (instance.window && !instance.window.isDestroyed()) instance.window.destroy();
          instance.window = null;
        } catch (_) {
        }
        try {
          if (instance.assetServer) {
            await new Promise((resolve2) => instance.assetServer.close(resolve2));
          }
          instance.assetServer = null;
          instance.assetBase = "";
        } catch (_) {
        }
      }
      module.exports = {
        configure: configure2,
        initSignEngine: initSignEngine2,
        getQrCode: getQrCode2,
        checkQrConnect: checkQrConnect2,
        requestOfficial: requestOfficial2,
        clear: clear2,
        destroyWindow,
        constants: { API_BASE: API_BASE2, AID: AID2, APP_VERSION: APP_VERSION2, AUTH_PARTITION }
      };
    }
  });

  // ../../electron/qishui/qishui-qr-login.js
  var require_qishui_qr_login = __commonJS({
    "../../electron/qishui/qishui-qr-login.js"(exports, module) {
      "use strict";
      init_globals();
      var fs = (init_fs(), __toCommonJS(fs_exports));
      var os = (init_os(), __toCommonJS(os_exports));
      var path = (init_path(), __toCommonJS(path_exports));
      var qishuiAuthV6 = require_qishui_auth_v6();
      var DEFAULT_CONFIG_FILE = __foliaProcessEnv.QISHUI_QR_CONFIG_FILE || path.join(__foliaDirname, ".qishui-qr-login.json");
      function defaultConfig() {
        return {
          deviceId: "",
          installId: "",
          verifyPortraitId: "",
          computerName: os.hostname() || "Windows-PC",
          cookie: "",
          msToken: ""
        };
      }
      function readConfig(file) {
        try {
          if (!file || !fs.existsSync(file)) return defaultConfig();
          const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
          return { ...defaultConfig(), ...parsed && typeof parsed === "object" ? parsed : {} };
        } catch (error) {
          console.warn("[QishuiQrLogin] ignored invalid config:", error && error.message || error);
          return defaultConfig();
        }
      }
      function writeConfig(file, value) {
        if (!file) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
      }
      function hasLoginCookie(cookie) {
        return /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt)=/i.test(String(cookie || ""));
      }
      function createQishuiQrLoginBridge(options) {
        options = options && typeof options === "object" ? options : {};
        const auth = options.auth || qishuiAuthV6;
        const configFile = options.configFile || __foliaProcessEnv.QISHUI_QR_CONFIG_FILE || DEFAULT_CONFIG_FILE;
        let config = {
          ...readConfig(configFile),
          ...options.initialConfig && typeof options.initialConfig === "object" ? options.initialConfig : {}
        };
        function getConfig2() {
          return { ...config };
        }
        function updateConfig2(partial) {
          partial = partial && typeof partial === "object" ? partial : {};
          config = { ...config, ...partial };
          writeConfig(configFile, config);
          return getConfig2();
        }
        auth.configure({ getConfig: getConfig2, updateConfig: updateConfig2 });
        async function createQrCode() {
          const result = await auth.getQrCode();
          const data = result && result.data || {};
          if (!data.token || !data.qrcode) {
            const error = new Error("QISHUI_QR_PAYLOAD_INCOMPLETE");
            error.code = "QISHUI_QR_PAYLOAD_INCOMPLETE";
            throw error;
          }
          return result;
        }
        async function checkQrConnect2(token) {
          token = String(token || "").trim();
          if (!token) {
            const error = new Error("QISHUI_QR_TOKEN_REQUIRED");
            error.code = "QISHUI_QR_TOKEN_REQUIRED";
            throw error;
          }
          return auth.checkQrConnect(token);
        }
        async function requestOfficial2(method, targetUrl, options2) {
          if (!auth || typeof auth.requestOfficial !== "function") {
            const error = new Error("汽水官方签名运行时不可用");
            error.code = "QISHUI_AUTH_RUNTIME_UNAVAILABLE";
            throw error;
          }
          return auth.requestOfficial(method, targetUrl, {
            ...options2 && typeof options2 === "object" ? options2 : {},
            cookie: getCookie()
          });
        }
        function getCookie() {
          return String(config.cookie || "").trim();
        }
        function getStatus() {
          const cookie = getCookie();
          return {
            provider: "qishui",
            loggedIn: hasLoginCookie(cookie),
            cookieReady: hasLoginCookie(cookie),
            deviceId: String(config.deviceId || ""),
            msTokenReady: !!config.msToken,
            configFile
          };
        }
        async function clear2() {
          await auth.clear();
          updateConfig2({ cookie: "", msToken: "" });
          return getStatus();
        }
        return {
          createQrCode,
          checkQrConnect: checkQrConnect2,
          requestOfficial: requestOfficial2,
          getCookie,
          getStatus,
          clear: clear2,
          _test: { getConfig: getConfig2, updateConfig: updateConfig2, configFile }
        };
      }
      var bridge = createQishuiQrLoginBridge();
      module.exports = Object.assign(bridge, {
        createQishuiQrLoginBridge,
        hasLoginCookie
      });
    }
  });

  // ../../electron/qishui/qishui-api.js
  var require_qishui_api = __commonJS({
    "../../electron/qishui/qishui-api.js"(exports, module) {
      "use strict";
      init_globals();
      var fs = (init_fs(), __toCommonJS(fs_exports));
      var crypto = (init_crypto(), __toCommonJS(crypto_exports));
      var http = (init_http(), __toCommonJS(http_exports));
      var https = (init_https(), __toCommonJS(https_exports));
      var path = (init_path(), __toCommonJS(path_exports));
      var QISHUI_API_BASE = (__foliaProcessEnv.QISHUI_API_BASE || "https://open.douyin.com").replace(/\/+$/, "");
      var QISHUI_RELATED_MEDIA_PATH = "/api/luna/v1/platform/feed/related-media/";
      var QISHUI_FEED_SONG_TAB_PATH = "/api/luna/v1/platform/feed/song-tab/";
      var QISHUI_SCOPE = "luna.openapi.platform.play_core";
      var DEFAULT_QISHUI_TOKEN_FILE = __foliaProcessEnv.QISHUI_TOKEN_FILE || path.join(__foliaDirname, ".qishui-token");
      var QISHUI_UA = "Folia/0.7.13 (Qishui official OpenAPI bridge)";
      var QISHUI_OAUTH_AUTH_URL = (__foliaProcessEnv.QISHUI_OAUTH_AUTH_URL || "https://open.douyin.com/platform/oauth/connect").replace(/\/+$/, "");
      var QISHUI_OAUTH_TOKEN_URL = __foliaProcessEnv.QISHUI_OAUTH_TOKEN_URL || "https://open.douyin.com/oauth/access_token/";
      var QISHUI_PUBLIC_ENABLED = __foliaProcessEnv.QISHUI_PUBLIC_ENABLED !== "0";
      var QISHUI_PUBLIC_SEARCH_URL = __foliaProcessEnv.QISHUI_PUBLIC_SEARCH_URL || "https://api-vehicle.volcengine.com/v2/search/type";
      var QISHUI_PUBLIC_CONTENTS_URL = __foliaProcessEnv.QISHUI_PUBLIC_CONTENTS_URL || "https://api-vehicle.volcengine.com/v2/custom/contents";
      var QISHUI_VIRTUAL_FEED_PLAYLIST_ID = "qishui-feed";
      var QISHUI_WEB_LIKED_PLAYLIST_ID = "qishui-liked";
      var QISHUI_WEB_RECENT_PLAYLIST_ID = "qishui-recent";
      var QISHUI_WEB_API_BASES = (__foliaProcessEnv.QISHUI_WEB_API_BASES || "https://api5-lq.qishui.com,https://api.qishui.com").split(",").map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean);
      var QISHUI_WEB_PC_API_BASE = (__foliaProcessEnv.QISHUI_WEB_PC_API_BASE || "https://api.qishui.com").replace(/\/+$/, "");
      var QISHUI_PUBLIC_HEADERS = {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Folia/0.7.13 (Qishui public catalog bridge)"
      };
      var QISHUI_WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.1.0 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36";
      var QISHUI_PC_APP_UA = "LunaPC/3.3.0(359450208)";
      var QISHUI_WEB_DEFAULT_PARAMS = {
        aid: "386088",
        app_name: "luna_pc",
        device_platform: "web",
        channel: "pc_web"
      };
      function qishuiDiagLog() {
      }
      function firstEnv(keys) {
        for (const key of keys) {
          const value = String(__foliaProcessEnv[key] || "").trim();
          if (value) return value;
        }
        return "";
      }
      function normalizeQishuiOAuthFileConfig(raw, file) {
        raw = raw && typeof raw === "object" ? raw : {};
        const oauth = raw.oauth && typeof raw.oauth === "object" ? raw.oauth : raw;
        return {
          clientKey: String(oauth.clientKey || oauth.client_key || oauth.clientId || oauth.client_id || oauth.key || "").trim(),
          clientSecret: String(oauth.clientSecret || oauth.client_secret || oauth.secret || "").trim(),
          redirectUri: String(oauth.redirectUri || oauth.redirect_uri || oauth.redirectURL || oauth.redirect_url || "").trim(),
          scope: String(oauth.scope || oauth.scopes || "").trim(),
          file,
          source: file ? "file" : ""
        };
      }
      function qishuiOAuthConfigFileCandidates() {
        const candidates = [];
        const add = (value) => {
          value = String(value || "").trim();
          if (!value) return;
          const resolved = path.resolve(value);
          if (!candidates.includes(resolved)) candidates.push(resolved);
        };
        add(firstEnv(["QISHUI_OAUTH_CONFIG_FILE", "DOUYIN_OAUTH_CONFIG_FILE"]));
        try {
          add(path.join(path.dirname(qishuiTokenFile()), ".qishui-oauth.json"));
        } catch (_) {
        }
        add(path.join(__foliaDirname, ".qishui-oauth.json"));
        add(path.join(__foliaDirname, "qishui-oauth.json"));
        return candidates;
      }
      function readQishuiOAuthFileConfig() {
        const candidates = qishuiOAuthConfigFileCandidates();
        for (const file of candidates) {
          try {
            if (!fs.existsSync(file)) continue;
            const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
            const config = normalizeQishuiOAuthFileConfig(parsed, file);
            if (config.clientKey || config.clientSecret || config.redirectUri || config.scope) return config;
          } catch (e) {
            console.warn("[QishuiOAuthConfig] ignored invalid config file:", file, e.message);
          }
        }
        return normalizeQishuiOAuthFileConfig(null, candidates[0] || "");
      }
      function getQishuiOAuthConfig() {
        const fileConfig = readQishuiOAuthFileConfig();
        const clientKey = firstEnv(["QISHUI_OAUTH_CLIENT_KEY", "QISHUI_CLIENT_KEY", "DOUYIN_CLIENT_KEY"]) || fileConfig.clientKey;
        const clientSecret = firstEnv(["QISHUI_OAUTH_CLIENT_SECRET", "QISHUI_CLIENT_SECRET", "DOUYIN_CLIENT_SECRET"]) || fileConfig.clientSecret;
        const redirectUri = firstEnv(["QISHUI_OAUTH_REDIRECT_URI", "QISHUI_REDIRECT_URI", "DOUYIN_REDIRECT_URI"]) || fileConfig.redirectUri;
        const scope = firstEnv(["QISHUI_OAUTH_SCOPE", "DOUYIN_OAUTH_SCOPE"]) || fileConfig.scope || QISHUI_SCOPE;
        const missing = [];
        if (!clientKey) missing.push("QISHUI_OAUTH_CLIENT_KEY");
        if (!clientSecret) missing.push("QISHUI_OAUTH_CLIENT_SECRET");
        if (!redirectUri) missing.push("QISHUI_OAUTH_REDIRECT_URI");
        else if (!/^https:\/\//i.test(redirectUri)) missing.push("QISHUI_OAUTH_REDIRECT_URI(https)");
        return {
          configured: missing.length === 0,
          clientKey,
          clientSecret,
          redirectUri,
          scope,
          authUrl: QISHUI_OAUTH_AUTH_URL,
          tokenUrl: QISHUI_OAUTH_TOKEN_URL,
          missing,
          configFile: fileConfig.file || "",
          configSource: fileConfig.source || (clientKey || clientSecret || redirectUri ? "env" : "")
        };
      }
      function qishuiOAuthConfigError(config) {
        const err = new Error("QISHUI_OAUTH_NOT_CONFIGURED");
        err.code = "QISHUI_OAUTH_NOT_CONFIGURED";
        err.missing = config && config.missing || [];
        err.message = "QISHUI_OAUTH_NOT_CONFIGURED: " + err.missing.join(", ");
        return err;
      }
      function buildQishuiOAuthAuthorizeUrl(state) {
        const config = getQishuiOAuthConfig();
        if (!config.configured) throw qishuiOAuthConfigError(config);
        const url = new URL(config.authUrl);
        url.searchParams.set("client_key", config.clientKey);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", config.scope);
        url.searchParams.set("redirect_uri", config.redirectUri);
        if (state) url.searchParams.set("state", state);
        return url.toString();
      }
      function createTtlCache(maxEntries, defaultTtlMs) {
        const store = /* @__PURE__ */ new Map();
        const inflight = /* @__PURE__ */ new Map();
        return {
          get(key) {
            const hit = store.get(key);
            if (!hit || Date.now() - hit.at > hit.ttl) return null;
            return hit.value;
          },
          set(key, value, ttlMs) {
            store.set(key, { at: Date.now(), ttl: ttlMs || defaultTtlMs, value });
            if (store.size > maxEntries) {
              const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
              if (oldest) store.delete(oldest[0]);
            }
          },
          clear() {
            store.clear();
            inflight.clear();
          },
          async wrap(key, ttlMs, fn) {
            const cached = this.get(key);
            if (cached !== null) return cached;
            if (inflight.has(key)) return inflight.get(key);
            const promise = Promise.resolve().then(fn).then((value) => {
              const resolvedTtlMs = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
              this.set(key, value, resolvedTtlMs);
              return value;
            }).finally(() => inflight.delete(key));
            inflight.set(key, promise);
            return promise;
          }
        };
      }
      var qishuiSearchCache = createTtlCache(80, 2 * 60 * 1e3);
      var qishuiLyricCache = createTtlCache(240, 30 * 60 * 1e3);
      var qishuiPublicDetailCache = createTtlCache(240, 30 * 60 * 1e3);
      var qishuiFeedCache = createTtlCache(16, 90 * 1e3);
      var qishuiWebLibraryCache = createTtlCache(24, 90 * 1e3);
      var qishuiWebPlaylistCache = createTtlCache(48, 90 * 1e3);
      var qishuiWebPlaylistCursorCache = /* @__PURE__ */ new Map();
      var qishuiMembershipCache = createTtlCache(24, 60 * 1e3);
      var qishuiMembershipPositiveHistory = /* @__PURE__ */ new Map();
      var QISHUI_MEMBERSHIP_POSITIVE_CACHE_MS = 10 * 1e3;
      var QISHUI_MEMBERSHIP_POSITIVE_GRACE_MS = 20 * 1e3;
      var qishuiTrackMetadataCache = createTtlCache(120, 20 * 1e3);
      var qishuiPlaybackCache = createTtlCache(120, 4 * 60 * 1e3);
      var qishuiOfficialBridge = null;
      var qishuiOfficialBridgeLoaded = false;
      function getQishuiOfficialBridge() {
        if (qishuiOfficialBridgeLoaded) return qishuiOfficialBridge;
        qishuiOfficialBridgeLoaded = true;
        try {
          const bridge = require_qishui_qr_login();
          if (bridge && typeof bridge.requestOfficial === "function") qishuiOfficialBridge = bridge;
        } catch (_) {
        }
        return qishuiOfficialBridge;
      }
      function requestText(targetUrl, opts, body) {
        opts = opts || {};
        return new Promise((resolve2, reject) => {
          const u = new URL(targetUrl);
          const lib = u.protocol === "https:" ? https : http;
          const req = lib.request(u, {
            method: opts.method || "GET",
            headers: opts.headers || {}
          }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
              const text = buffer_default.concat(chunks).toString("utf8");
              if (response.statusCode >= 400) {
                const err = new Error("HTTP " + response.statusCode);
                err.statusCode = response.statusCode;
                err.body = text;
                reject(err);
                return;
              }
              resolve2(text);
            });
          });
          req.setTimeout(Number(opts.timeoutMs) || 7e3, () => req.destroy(new Error("Request timeout")));
          req.on("error", reject);
          if (body) req.write(body);
          req.end();
        });
      }
      async function requestJson(targetUrl, opts, body) {
        const text = await requestText(targetUrl, opts, body);
        try {
          return JSON.parse(text);
        } catch (e) {
          const err = new Error("Invalid JSON from Qishui OpenAPI");
          err.cause = e;
          err.body = text;
          throw err;
        }
      }
      function urlWithParams(baseUrl, params) {
        const u = new URL(baseUrl);
        Object.keys(params || {}).forEach((key) => {
          const value = params[key];
          if (value == null || value === "") return;
          u.searchParams.set(key, String(value));
        });
        return u.toString();
      }
      function qishuiSessionCookieHeader(cookieText) {
        const normalized = normalizeQishuiCookieInput(cookieText);
        const obj = qishuiCookieObject(normalized);
        if (qishuiCookieHasLogin(normalized)) return normalized;
        const sessionid = normalizeText(obj.sessionid || obj.sessionid_ss || "");
        return sessionid ? "sessionid=" + sessionid + ";" : normalized;
      }
      function qishuiHeadersWithCookie(headers, cookieText) {
        const out = Object.assign({}, headers || {});
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (cookie) out.Cookie = cookie;
        return out;
      }
      function qishuiPcStatusError(payload, fallback) {
        if (!payload || typeof payload !== "object") return null;
        const code = Number(payload.status_code == null ? payload.error_code : payload.status_code);
        if (!isFinite(code) || code === 0) return null;
        const info = payload.status_info || {};
        const message = normalizeText(info.status_msg || payload.message || payload.status_msg || fallback || "QISHUI_PC_API_ERROR");
        const err = new Error(message || "QISHUI_PC_API_ERROR");
        err.code = "QISHUI_PC_API_" + code;
        err.statusCode = code;
        err.body = payload;
        return err;
      }
      function qishuiTokenFile() {
        return __foliaProcessEnv.QISHUI_TOKEN_FILE || DEFAULT_QISHUI_TOKEN_FILE;
      }
      function normalizeQishuiToken(value) {
        let token = String(value || "").trim();
        token = token.replace(/^bearer\s+/i, "").trim();
        const headerMatch = token.match(/(?:access-token|access_token)\s*[:=]\s*([^;\s]+)/i);
        if (headerMatch) token = headerMatch[1].trim();
        return token;
      }
      var QISHUI_COOKIE_ATTRIBUTE_NAMES = /* @__PURE__ */ new Set(["path", "domain", "expires", "max-age", "samesite", "secure", "httponly"]);
      function collectQishuiCookiePair(picked, key, value) {
        key = String(key || "").trim();
        if (!key || QISHUI_COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
        if (value === null || value === void 0) return;
        picked.set(key, String(value).trim());
      }
      function collectQishuiCookieInput(input, picked) {
        if (input === null || input === void 0) return;
        if (Array.isArray(input)) {
          input.forEach((item) => collectQishuiCookieInput(item, picked));
          return;
        }
        if (typeof input === "object") {
          if (input.name && Object.prototype.hasOwnProperty.call(input, "value")) {
            collectQishuiCookiePair(picked, input.name, input.value);
            return;
          }
          Object.keys(input).forEach((key) => {
            const value = input[key];
            if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
              collectQishuiCookiePair(picked, key, value.value);
            } else if (typeof value !== "object") {
              collectQishuiCookiePair(picked, key, value);
            }
          });
          return;
        }
        String(input).split(/\r?\n/).forEach((line) => {
          line.split(";").forEach((part) => {
            const raw = String(part || "").trim();
            const idx = raw.indexOf("=");
            if (idx <= 0) return;
            collectQishuiCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
          });
        });
      }
      function normalizeQishuiCookieInput(input) {
        const picked = /* @__PURE__ */ new Map();
        collectQishuiCookieInput(input, picked);
        return Array.from(picked.entries()).filter(([key, value]) => key && value != null && String(value) !== "").map(([key, value]) => `${key}=${value}`).join("; ");
      }
      function qishuiCookieObject(cookieText) {
        const out = {};
        String(cookieText || "").split(";").forEach((part) => {
          const idx = part.indexOf("=");
          if (idx <= 0) return;
          const key = part.slice(0, idx).trim();
          const value = part.slice(idx + 1).trim();
          if (key) out[key] = value;
        });
        return out;
      }
      function qishuiCookieHasLogin(cookieText) {
        return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt|uid_tt_ss)=/i.test(String(cookieText || ""));
      }
      function qishuiCookieFingerprint(cookieText) {
        const normalized = normalizeQishuiCookieInput(cookieText);
        return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
      }
      function qishuiCookieUserId(cookieText) {
        const obj = qishuiCookieObject(cookieText);
        const raw = String(obj.uid_tt || obj.uid_tt_ss || obj.sessionid || obj.sessionid_ss || obj.sid_guard || "").trim();
        if (!raw) return "";
        return "web:" + crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12);
      }
      function clearQishuiRuntimeCaches() {
        qishuiSearchCache.clear && qishuiSearchCache.clear();
        qishuiFeedCache.clear && qishuiFeedCache.clear();
        qishuiWebLibraryCache.clear && qishuiWebLibraryCache.clear();
        qishuiWebPlaylistCache.clear && qishuiWebPlaylistCache.clear();
        qishuiWebPlaylistCursorCache.clear();
        qishuiMembershipCache.clear && qishuiMembershipCache.clear();
        qishuiMembershipPositiveHistory.clear();
        qishuiTrackMetadataCache.clear && qishuiTrackMetadataCache.clear();
        qishuiPlaybackCache.clear && qishuiPlaybackCache.clear();
      }
      function qishuiAccessTokenInfo() {
        const envKeys = ["QISHUI_ACCESS_TOKEN", "DOUYIN_ACCESS_TOKEN", "DOUYIN_OPEN_ACCESS_TOKEN"];
        for (const key of envKeys) {
          const token = normalizeQishuiToken(__foliaProcessEnv[key] || "");
          if (token) return { token, source: "env:" + key, file: qishuiTokenFile() };
        }
        const file = qishuiTokenFile();
        try {
          if (fs.existsSync(file)) {
            const token = normalizeQishuiToken(fs.readFileSync(file, "utf8"));
            if (token) return { token, source: "file", file };
          }
        } catch (_) {
        }
        return { token: "", source: "", file };
      }
      function qishuiAccessToken() {
        return qishuiAccessTokenInfo().token;
      }
      function saveQishuiAccessToken(value) {
        const token = normalizeQishuiToken(value);
        if (!token || token.length < 10) {
          const err = new Error("INVALID_QISHUI_TOKEN");
          err.code = "INVALID_QISHUI_TOKEN";
          throw err;
        }
        const file = qishuiTokenFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, token, "utf8");
        clearQishuiRuntimeCaches();
        return { ...getQishuiStatus(), saved: true };
      }
      function clearQishuiAccessToken() {
        const file = qishuiTokenFile();
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (_) {
        }
        clearQishuiRuntimeCaches();
        return { ...getQishuiStatus(), ok: true };
      }
      async function exchangeQishuiOAuthCode(code) {
        code = normalizeText(code);
        if (!code) {
          const err = new Error("QISHUI_OAUTH_CODE_REQUIRED");
          err.code = "QISHUI_OAUTH_CODE_REQUIRED";
          throw err;
        }
        const config = getQishuiOAuthConfig();
        if (!config.configured) throw qishuiOAuthConfigError(config);
        const body = new URLSearchParams();
        body.set("client_key", config.clientKey);
        body.set("client_secret", config.clientSecret);
        body.set("code", code);
        body.set("grant_type", "authorization_code");
        const bodyText = body.toString();
        const json = await requestJson(config.tokenUrl, {
          method: "POST",
          timeoutMs: 1e4,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": buffer_default.byteLength(bodyText),
            "User-Agent": QISHUI_UA
          }
        }, bodyText);
        const data = json && json.data || json || {};
        const errCode = Number(data.error_code || data.err_code || json.error_code || json.err_code || 0);
        if (errCode) {
          const err = new Error(String(data.description || data.message || json.description || json.message || "QISHUI_OAUTH_TOKEN_ERROR"));
          err.code = errCode;
          err.body = json;
          throw err;
        }
        const token = normalizeQishuiToken(data.access_token || json.access_token || "");
        if (!token) {
          const err = new Error("QISHUI_OAUTH_TOKEN_MISSING");
          err.code = "QISHUI_OAUTH_TOKEN_MISSING";
          err.body = json;
          throw err;
        }
        const status = saveQishuiAccessToken(token);
        return {
          ...status,
          oauth: true,
          openId: data.open_id || data.openid || "",
          scope: data.scope || status.scope,
          expiresIn: data.expires_in || 0,
          refreshExpiresIn: data.refresh_expires_in || 0
        };
      }
      function qishuiRestriction(category, message, action, extra) {
        return {
          provider: "qishui",
          category,
          action: action || "",
          message,
          ...extra || {}
        };
      }
      function qishuiUnavailable(message, category, extra) {
        const restriction = qishuiRestriction(
          category || "provider_limited",
          message || "汽水音乐开放平台当前没有公开可交给播放器直连的音频 URL，已按匹配源处理。",
          "switch_source",
          { playbackMode: "recommend-match", scope: QISHUI_SCOPE }
        );
        return Object.assign({
          provider: "qishui",
          playbackMode: "recommend-match",
          url: "",
          playable: false,
          trial: false,
          loggedIn: !!qishuiAccessToken(),
          playbackKeyReady: false,
          restriction,
          reason: restriction.category,
          message: restriction.message
        }, extra || {});
      }
      function getQishuiStatus(cookieText) {
        const tokenInfo = qishuiAccessTokenInfo();
        const tokenConfigured = !!tokenInfo.token;
        const cookie = normalizeQishuiCookieInput(cookieText);
        const webSession = qishuiCookieHasLogin(cookie);
        const configured = tokenConfigured || webSession;
        const oauthConfig = getQishuiOAuthConfig();
        return {
          provider: "qishui",
          label: "汽水音乐",
          short: "QS",
          configured,
          tokenConfigured,
          webSession,
          cookieReady: webSession,
          // Only an authenticated Passport Web session is an account login.
          // A legacy OpenAPI token may still power catalogue/recommendation calls,
          // but must never bypass the official QR login or impersonate a user.
          loggedIn: webSession,
          playbackMode: webSession ? "direct-url" : "recommend-match",
          scope: QISHUI_SCOPE,
          userId: webSession ? qishuiCookieUserId(cookie) : "",
          nickname: webSession ? "汽水音乐账号" : "",
          vipType: 0,
          vipLevel: "none",
          isVip: false,
          isSvip: false,
          vipLabel: "无VIP",
          membershipKnown: false,
          tokenFile: tokenInfo.file,
          tokenSource: tokenInfo.source,
          oauthConfigured: oauthConfig.configured,
          oauthMissing: oauthConfig.missing,
          oauthScope: oauthConfig.scope,
          oauthConfigSource: oauthConfig.configSource,
          // Legacy quick-check guard: search: configured || QISHUI_PUBLIC_ENABLED.
          capabilities: {
            search: tokenConfigured || webSession || QISHUI_PUBLIC_ENABLED,
            relatedMedia: tokenConfigured,
            feedSongTab: tokenConfigured || webSession,
            lyric: true,
            playableUrl: webSession,
            login: true,
            webOAuth: oauthConfig.configured,
            userPlaylists: configured,
            playlistTracks: configured,
            webSession
          },
          message: webSession ? "汽水音乐官方扫码登录已连接，可同步歌单与我的喜欢，并按账号权益播放。" : tokenConfigured ? "已有旧版开放平台目录授权；账号功能仍需完成官方扫码登录。" : QISHUI_PUBLIC_ENABLED ? "请使用汽水音乐 App 扫描 Folia 中的汽水官方二维码；未登录时仅保留公开搜索匹配。" : "请使用汽水音乐 App 扫描 Folia 中的汽水官方二维码完成登录。"
        };
      }
      function qishuiUrl(apiPath) {
        return QISHUI_API_BASE + apiPath;
      }
      async function qishuiPost(apiPath, payload) {
        const token = qishuiAccessToken();
        if (!token) {
          const err = new Error("QISHUI_TOKEN_REQUIRED");
          err.code = "QISHUI_TOKEN_REQUIRED";
          throw err;
        }
        const body = JSON.stringify(payload || {});
        const json = await requestJson(qishuiUrl(apiPath), {
          method: "POST",
          timeoutMs: 7e3,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": buffer_default.byteLength(body),
            "User-Agent": QISHUI_UA,
            "access-token": token
          }
        }, body);
        const errCode = Number(json && json.data && (json.data.error_code || json.data.err_code || json.data.code) || json && (json.error_code || json.err_code || json.code) || 0);
        if (errCode) {
          const err = new Error(String(json && json.data && (json.data.description || json.data.message) || json.description || json.message || "QISHUI_API_ERROR"));
          err.code = errCode;
          err.body = json;
          throw err;
        }
        return json;
      }
      function normalizeText(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
      }
      function normalizeLyricBody(value) {
        return String(value == null ? "" : value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      }
      function qishuiLyricTimestamp(ms) {
        ms = Math.max(0, Number(ms) || 0);
        const minutes = Math.floor(ms / 6e4);
        const seconds = Math.floor(ms % 6e4 / 1e3);
        const centiseconds = Math.floor(ms % 1e3 / 10);
        return "[" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(centiseconds).padStart(2, "0") + "]";
      }
      function qishuiConvertLyric(value) {
        const input = normalizeLyricBody(value);
        if (!input) return { lyric: "", yrc: "" };
        const lrcLines = [];
        const yrcLines = [];
        let converted = false;
        input.split("\n").forEach((rawLine) => {
          const line = String(rawLine || "").trim();
          const timed = line.match(/^\[(\d+),(\d+)\](.*)$/);
          if (!timed) return;
          const lineStart = Math.max(0, Number(timed[1]) || 0);
          const lineDuration = Math.max(0, Number(timed[2]) || 0);
          const body = timed[3] || "";
          const wordPattern = /([<(])(\d+),(\d+),(\d+)[>)]([^<(]*)/g;
          let wordMatch;
          let text = "";
          let yrcBody = "";
          while (wordMatch = wordPattern.exec(body)) {
            const rawStart = Math.max(0, Number(wordMatch[2]) || 0);
            const wordDuration = Math.max(0, Number(wordMatch[3]) || 0);
            const wordText = String(wordMatch[5] || "");
            if (!wordText) continue;
            const absoluteStart = wordMatch[1] === "<" ? lineStart + rawStart : rawStart >= Math.max(0, lineStart - 500) ? rawStart : lineStart + rawStart;
            text += wordText;
            yrcBody += "(" + absoluteStart + "," + wordDuration + "," + (Number(wordMatch[4]) || 0) + ")" + wordText;
          }
          if (!text) text = body.replace(/[<(]\d+,\d+,\d+[>)]/g, "");
          text = text.replace(/\s+/g, " ").trim();
          if (!text) return;
          converted = true;
          lrcLines.push(qishuiLyricTimestamp(lineStart) + text);
          yrcLines.push("[" + lineStart + "," + lineDuration + "]" + (yrcBody || text));
        });
        if (!converted) return { lyric: input, yrc: "" };
        return {
          lyric: lrcLines.join("\n"),
          yrc: yrcLines.join("\n")
        };
      }
      function firstUrl(value) {
        if (!value) return "";
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return value.map(firstUrl).find(Boolean) || "";
        if (typeof value === "object") {
          return firstUrl(value.url_list || value.urls || value.url || value.uri || value.main_url || value.cover_url || value.download_url);
        }
        return "";
      }
      function qishuiImageUrl(value, suffix) {
        if (!value) return "";
        if (typeof value === "string") {
          const text = normalizeText(value);
          if (!/^https?:\/\//i.test(text)) return "";
          return suffix && !text.includes("~") ? text + suffix : text;
        }
        if (Array.isArray(value)) return value.map((item) => qishuiImageUrl(item, suffix)).find(Boolean) || "";
        if (typeof value !== "object") return "";
        const cover = normalizeText(firstUrl(value.urls || value.url_list || value.urlList || value.url || value.main_url || value.cover_url || value.image_url || ""));
        const uri = normalizeText(value.uri || value.url_key || value.image_uri || value.cover_uri || "");
        let out = cover;
        if (out && uri && !out.includes(uri)) out += uri;
        if (!out && /^https?:\/\//i.test(uri)) out = uri;
        if (!/^https?:\/\//i.test(out)) return "";
        return suffix && !out.includes("~") ? out + suffix : out;
      }
      function qishuiFirstImageUrl(suffix) {
        for (let i = 1; i < arguments.length; i++) {
          const url = qishuiImageUrl(arguments[i], suffix);
          if (url) return url;
        }
        return "";
      }
      function pickObject() {
        for (let i = 0; i < arguments.length; i++) {
          const value = arguments[i];
          if (value && typeof value === "object" && !Array.isArray(value)) return value;
        }
        return {};
      }
      function qishuiProfileFromUser(user) {
        user = user && typeof user === "object" ? user : {};
        const nickname = normalizeText(
          user.nickname || user.nick_name || user.nickName || user.display_name || user.displayName || user.name || user.public_name || user.publicName || user.douyin_id || ""
        );
        const userId = normalizeText(
          user.id || user.user_id || user.userId || user.uid || user.sec_uid || user.secUid || user.open_id || ""
        );
        const avatar = qishuiFirstImageUrl(
          "~c5_300x300.jpg",
          user.larger_avatar_url,
          user.medium_avatar_url,
          user.avatar_url,
          user.avatarUrl,
          user.avatar,
          user.user_avatar,
          user.pic,
          user.icon
        );
        return {
          userId,
          nickname,
          avatar,
          douyinId: normalizeText(user.douyin_id || user.unique_id || user.short_id || ""),
          profileReady: !!(userId || nickname || avatar)
        };
      }
      var QISHUI_VIP_NUMBER_KEYS = /* @__PURE__ */ new Set([
        "viptype",
        "viplevel",
        "membertype",
        "memberlevel",
        "musicviptype",
        "musicviplevel"
      ]);
      var QISHUI_SVIP_NUMBER_KEYS = /* @__PURE__ */ new Set([
        "sviptype",
        "sviplevel",
        "superviptype",
        "superviplevel"
      ]);
      var QISHUI_VIP_FLAG_KEYS = /* @__PURE__ */ new Set([
        "isvip",
        "ismember",
        "hasvip",
        "hasmembership",
        "vipactive",
        "vipenabled"
      ]);
      var QISHUI_SVIP_FLAG_KEYS = /* @__PURE__ */ new Set([
        "issvip",
        "issupervip",
        "hassvip",
        "hassupervip",
        "svipactive",
        "svipenabled"
      ]);
      var QISHUI_MEMBERSHIP_LABEL_KEYS = /* @__PURE__ */ new Set([
        "viplevelname",
        "vipname",
        "memberlevelname",
        "membername",
        "membershiplevel",
        "membershiptype",
        // 汽水 web /luna/pc/me 用 vip_stage 表示会员档位：vip=会员、svip=超级会员。
        // 实测真实 SVIP 账号该字段返回 "svip"，此前未被识别导致档位锁死、面板只显示 VIP。
        "vipstage"
      ]);
      var QISHUI_VIP_CONTAINER_KEYS = /* @__PURE__ */ new Set([
        "vipinfo",
        "vipdetail",
        "vipbenefit",
        "vippackage",
        "memberinfo",
        "memberdetail",
        "memberbenefit",
        "memberpackage",
        "membershipinfo",
        "membershipdetail"
      ]);
      var QISHUI_SVIP_CONTAINER_KEYS = /* @__PURE__ */ new Set([
        "svipinfo",
        "svipdetail",
        "svipbenefit",
        "svippackage",
        "supervipinfo",
        "supervipdetail",
        "supervipbenefit",
        "supervippackage"
      ]);
      var QISHUI_MEMBERSHIP_STATUS_KEYS = /* @__PURE__ */ new Set([
        "status",
        "state",
        "active",
        "valid",
        "enabled",
        "isactive",
        "isvalid",
        "isenabled"
      ]);
      var QISHUI_MEMBERSHIP_GENERIC_EXPIRY_KEYS = /* @__PURE__ */ new Set([
        "expiretime",
        "expiresat",
        "expirationtime",
        "expiredat",
        "endtime",
        "validuntil"
      ]);
      var QISHUI_VIP_EXPIRY_KEYS = /* @__PURE__ */ new Set([
        "vipexpiretime",
        "vipexpiresat",
        "vipexpiredat",
        "vipendtime",
        "memberexpiretime",
        "memberexpiresat",
        "memberexpiredat",
        "memberendtime"
      ]);
      var QISHUI_SVIP_EXPIRY_KEYS = /* @__PURE__ */ new Set([
        "svipexpiretime",
        "svipexpiresat",
        "svipexpiredat",
        "svipendtime"
      ]);
      function qishuiNormalizedFieldKey(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
      }
      function qishuiExplicitPositive(value) {
        if (value === true) return true;
        if (typeof value === "number") return Number.isFinite(value) && value > 0;
        const text = normalizeText(value).toLowerCase();
        if (!text) return false;
        if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) > 0;
        return /^(true|yes|active|valid|enabled|opened|vip|svip|premium|member|会员|已开通|有效)$/.test(text);
      }
      function qishuiExplicitNegative(value) {
        if (value === false || value === null) return true;
        if (typeof value === "number") return Number.isFinite(value) && value <= 0;
        const text = normalizeText(value).toLowerCase();
        if (!text) return false;
        if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) <= 0;
        return /^(false|no|inactive|invalid|disabled|closed|expired|none|free|normal|ordinary|非会员|普通用户|未开通|无vip|已过期|过期)$/.test(text);
      }
      function qishuiMembershipLevelValue(value) {
        const text = normalizeText(value).toLowerCase().replace(/[\s_-]+/g, "");
        if (/^(svip|supervip|超级会员|超级vip|豪华会员)$/.test(text)) return "svip";
        if (/^(vip|premium|member|会员|普通会员)$/.test(text)) return "vip";
        if (/^(none|free|normal|ordinary|novip|非会员|普通用户|未开通|无vip|已过期|过期)$/.test(text)) return "none";
        return "";
      }
      function qishuiMembershipExpiryMillis(value) {
        if (value === null || value === void 0 || value === "") return 0;
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
          return number < 1e11 ? number * 1e3 : number;
        }
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      }
      function qishuiMembershipObjectState(value, level) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { known: false, active: null, expiresAt: 0 };
        }
        let known = false;
        let statusPositive = false;
        let statusNegative = false;
        let genericExpiryKnown = false;
        let genericExpiryExpired = false;
        let genericFutureExpiry = 0;
        let levelExpiryKnown = false;
        let levelExpiryExpired = false;
        let levelFutureExpiry = 0;
        const levelExpiryKeys = level === "svip" ? QISHUI_SVIP_EXPIRY_KEYS : level === "vip" ? QISHUI_VIP_EXPIRY_KEYS : null;
        for (const [key, item] of Object.entries(value)) {
          const normalizedKey = qishuiNormalizedFieldKey(key);
          const isGenericExpiry = QISHUI_MEMBERSHIP_GENERIC_EXPIRY_KEYS.has(normalizedKey);
          const isLevelExpiry = levelExpiryKeys ? levelExpiryKeys.has(normalizedKey) : QISHUI_VIP_EXPIRY_KEYS.has(normalizedKey) || QISHUI_SVIP_EXPIRY_KEYS.has(normalizedKey);
          if (isGenericExpiry || isLevelExpiry) {
            const expiresAt = qishuiMembershipExpiryMillis(item);
            const isKnownExpiry = expiresAt > 0 || item !== "" && item !== null && item !== void 0 && Number.isFinite(Number(item)) && Number(item) <= 0;
            if (!isKnownExpiry) continue;
            known = true;
            if (isLevelExpiry) {
              levelExpiryKnown = true;
              if (expiresAt > Date.now()) {
                levelFutureExpiry = Math.max(levelFutureExpiry, expiresAt);
              } else {
                levelExpiryExpired = true;
              }
            } else {
              genericExpiryKnown = true;
              if (expiresAt > Date.now()) {
                genericFutureExpiry = Math.max(genericFutureExpiry, expiresAt);
              } else {
                genericExpiryExpired = true;
              }
            }
            continue;
          }
          if (!QISHUI_MEMBERSHIP_STATUS_KEYS.has(normalizedKey)) continue;
          if (qishuiExplicitNegative(item)) {
            known = true;
            statusNegative = true;
          } else if (qishuiExplicitPositive(item)) {
            known = true;
            statusPositive = true;
          }
        }
        const expiryKnown = levelExpiryKnown || genericExpiryKnown;
        const expiryExpired = levelExpiryKnown ? levelExpiryExpired : genericExpiryExpired;
        const futureExpiry = levelExpiryKnown ? levelFutureExpiry : genericFutureExpiry;
        const active = statusNegative || expiryExpired ? false : futureExpiry > 0 || !expiryKnown && statusPositive ? true : expiryKnown ? false : null;
        return {
          known,
          active,
          expiresAt: active === true ? futureExpiry : 0
        };
      }
      function qishuiMembershipFromData(value) {
        value = value && typeof value === "object" ? value : {};
        let membershipKnown = false;
        let isVip = false;
        let isSvip = false;
        let vipType = 0;
        let svipType = 0;
        let vipExpiresAt = 0;
        let svipExpiresAt = 0;
        let visited = 0;
        const rememberExpiry = (level, expiresAt) => {
          expiresAt = Number(expiresAt) || 0;
          if (expiresAt <= Date.now()) return;
          if (level === "svip") {
            if (!svipExpiresAt || expiresAt < svipExpiresAt) svipExpiresAt = expiresAt;
            return;
          }
          if (level === "vip" && (!vipExpiresAt || expiresAt < vipExpiresAt)) vipExpiresAt = expiresAt;
        };
        const applyLevel = (level, numericValue, active, expiresAt) => {
          if (active === false || !level) return;
          if (level === "svip") {
            isSvip = true;
            isVip = true;
            svipType = Math.max(svipType, Number(numericValue) || 1);
            rememberExpiry("svip", expiresAt);
            return;
          }
          if (level === "vip") {
            isVip = true;
            vipType = Math.max(vipType, Number(numericValue) || 1);
            rememberExpiry("vip", expiresAt);
          }
        };
        const visit = (node, depth) => {
          if (!node || typeof node !== "object" || depth > 6 || visited > 600) return;
          visited += 1;
          if (Array.isArray(node)) {
            node.slice(0, 120).forEach((item) => visit(item, depth + 1));
            return;
          }
          const vipObjectState = qishuiMembershipObjectState(node, "vip");
          const svipObjectState = qishuiMembershipObjectState(node, "svip");
          for (const [key, item] of Object.entries(node).slice(0, 160)) {
            const normalizedKey = qishuiNormalizedFieldKey(key);
            if (QISHUI_SVIP_NUMBER_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              const number = Number(item);
              if (Number.isFinite(number) && number > 0) applyLevel("svip", number, svipObjectState.active, svipObjectState.expiresAt);
            } else if (QISHUI_VIP_NUMBER_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              const number = Number(item);
              if (Number.isFinite(number) && number > 0) applyLevel("vip", number, vipObjectState.active, vipObjectState.expiresAt);
            } else if (QISHUI_SVIP_FLAG_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              if (qishuiExplicitPositive(item)) applyLevel("svip", 1, svipObjectState.active, svipObjectState.expiresAt);
            } else if (QISHUI_VIP_FLAG_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              if (qishuiExplicitPositive(item)) applyLevel("vip", 1, vipObjectState.active, vipObjectState.expiresAt);
            } else if (QISHUI_MEMBERSHIP_LABEL_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              const level = qishuiMembershipLevelValue(item);
              const state = level === "svip" ? svipObjectState : vipObjectState;
              applyLevel(level, 1, state.active, state.expiresAt);
            } else if (QISHUI_SVIP_CONTAINER_KEYS.has(normalizedKey) || QISHUI_VIP_CONTAINER_KEYS.has(normalizedKey)) {
              membershipKnown = true;
              const level = QISHUI_SVIP_CONTAINER_KEYS.has(normalizedKey) ? "svip" : "vip";
              const state = qishuiMembershipObjectState(item, level);
              if (state.active === true) {
                applyLevel(
                  level,
                  1,
                  true,
                  state.expiresAt
                );
              }
            }
            if (item && typeof item === "object") visit(item, depth + 1);
          }
        };
        visit(value, 0);
        if (isSvip) isVip = true;
        const vipLevel = isSvip ? "svip" : isVip ? "vip" : "none";
        const activeExpiries = [vipExpiresAt, svipExpiresAt].filter((item) => item > Date.now());
        return {
          membershipKnown,
          vipType: isSvip ? svipType : vipType,
          vipLevel,
          isVip,
          isSvip,
          vipLabel: vipLevel === "svip" ? "SVIP" : vipLevel === "vip" ? "VIP" : "无VIP",
          expiresAt: activeExpiries.length ? Math.min(...activeExpiries) : 0
        };
      }
      function qishuiPlaybackMembershipFromPayload(payload) {
        const data = payload && payload.data || payload || {};
        const trustedCandidates = [
          data.user_membership,
          data.userMembership,
          data.account_membership,
          data.accountMembership,
          data.user && data.user.membership,
          data.account && data.account.membership,
          data.me && data.me.membership
        ].filter((item) => item && typeof item === "object");
        if (trustedCandidates.length) {
          const trusted = qishuiMembershipFromData({ membership_sources: trustedCandidates });
          if (trusted.membershipKnown) return trusted;
        }
        const ambiguousCandidates = [
          data.membership,
          data.membership_info,
          data.membershipInfo
        ].filter((item) => item && typeof item === "object");
        void ambiguousCandidates;
        return {
          membershipKnown: false,
          vipType: 0,
          vipLevel: "none",
          isVip: false,
          isSvip: false,
          vipLabel: "无VIP",
          expiresAt: 0
        };
      }
      function qishuiProfileFromMeData(meData) {
        const data = meData && meData.data || meData || {};
        const user = pickObject(data.my_info, data.myInfo, data.user, data.user_info, data.userInfo, data.account, data.me, data);
        const profile = qishuiProfileFromUser(user);
        if (!profile.userId) {
          profile.userId = normalizeText(data.user_id || data.userId || data.uid || data.id || "");
        }
        if (!profile.nickname) {
          profile.nickname = normalizeText(data.nickname || data.nick_name || data.name || data.douyin_id || "");
        }
        if (!profile.avatar) {
          profile.avatar = qishuiFirstImageUrl(
            "~c5_300x300.jpg",
            data.larger_avatar_url,
            data.medium_avatar_url,
            data.avatar_url,
            data.avatar,
            data.pic
          );
        }
        Object.assign(profile, qishuiMembershipFromData(data));
        profile.profileReady = !!(profile.userId || profile.nickname || profile.avatar);
        return profile;
      }
      function pickArray() {
        for (let i = 0; i < arguments.length; i++) {
          const value = arguments[i];
          if (Array.isArray(value)) return value;
        }
        return [];
      }
      function qishuiObjectString(obj, keys) {
        obj = obj && typeof obj === "object" ? obj : {};
        for (const key of keys || []) {
          const value = obj[key];
          if (value === null || value === void 0) continue;
          if (Array.isArray(value)) {
            const text = value.map((item) => normalizeText(item)).find(Boolean);
            if (text) return text;
            continue;
          }
          if (typeof value !== "object") {
            const text = normalizeText(value);
            if (text) return text;
          }
        }
        return "";
      }
      function qishuiObjectNumber(obj, keys) {
        const text = qishuiObjectString(obj, keys);
        const num = Number(text);
        return Number.isFinite(num) ? num : 0;
      }
      function qishuiNormalizeDurationSeconds(value) {
        const num = Number(value) || 0;
        if (!num) return 0;
        return num > 1e3 ? Math.round(num / 1e3) : Math.round(num);
      }
      function qishuiNormalizeBitrateKbps(value) {
        const num = Number(value) || 0;
        if (!num) return 0;
        return num > 1e3 ? Math.round(num / 1e3) : Math.round(num);
      }
      function qishuiBitrateForUi(value) {
        const kbps = qishuiNormalizeBitrateKbps(value);
        return kbps > 0 ? kbps * 1e3 : 0;
      }
      function qishuiQualityRank(quality, format, bitrate) {
        const q = normalizeText(quality).toLowerCase().replace(/[-_\s]/g, "");
        const f = normalizeText(format).toLowerCase();
        const br = qishuiNormalizeBitrateKbps(bitrate);
        const losslessFormat = /flac|alac|wav/.test(f);
        const losslessLabel = /lossless|flac|sq|svip/.test(q);
        const hiresLabel = /hires|master/.test(q);
        if (hiresLabel && (losslessFormat || br >= 900)) return 110;
        if (losslessLabel || losslessFormat || br >= 900) return 100;
        if (hiresLabel) return 90;
        if (/atmos|dolby|spatial/.test(q)) return 88;
        if (/higher|high|320/.test(q) || br >= 320) return 70;
        if (/standard|medium|normal|128/.test(q) || br >= 128) return 50;
        if (/low|preview/.test(q)) return 10;
        return br > 0 ? 20 : 0;
      }
      function qishuiNormalizeAppQuality(q) {
        q = normalizeText(q || "").toLowerCase().replace(/[-_\s]/g, "");
        if (/^standard|medium|normal|std|128|higher/.test(q)) return "standard";
        if (/^exhigh|high|hq|320|highest|excellent|superhigh/.test(q)) return "exhigh";
        if (/^lossless|flac|sq/.test(q)) return "lossless";
        if (/^hires|hi-res|highres|master/.test(q)) return "hires";
        if (/^spatial|atmos|dolby|immersive/.test(q)) return "atmos";
        return "standard";
      }
      function qishuiStreamAppTier(stream) {
        stream = stream && typeof stream === "object" ? stream : {};
        const q = normalizeText(stream.quality || stream.definition || stream.quality_type || "").toLowerCase().replace(/[-_\s]/g, "");
        if (/^(hi-?res|highres|master|hires)/.test(q)) return "hires";
        if (/^(spatial|atmos|dolby|immersive)/.test(q)) return "atmos";
        if (/^(lossless|flac|sq)/.test(q)) return "lossless";
        if (/^(medium|standard|normal|std|128k?|higher)/.test(q)) return "standard";
        if (/^(highest|excellent|superhigh|hq|320k?|high$|exhigh)/.test(q)) return "exhigh";
        const br = qishuiNormalizeBitrateKbps(stream.bitrate);
        if (br >= 900) return "lossless";
        if (br >= 320) return "exhigh";
        return "standard";
      }
      function qishuiBetterStreamCandidate(a, b) {
        if (!b) return true;
        const ad = qishuiNormalizeDurationSeconds(a && a.duration);
        const bd = qishuiNormalizeDurationSeconds(b && b.duration);
        if (ad > 0 || bd > 0) {
          if (ad > bd + 1) return true;
          if (bd > ad + 1) return false;
        }
        const ar = qishuiQualityRank(a && a.quality, a && a.format, a && a.bitrate);
        const br = qishuiQualityRank(b && b.quality, b && b.format, b && b.bitrate);
        if (ar !== br) return ar > br;
        const ab = qishuiNormalizeBitrateKbps(a && a.bitrate);
        const bb = qishuiNormalizeBitrateKbps(b && b.bitrate);
        if (ab !== bb) return ab > bb;
        return (Number(a && a.size) || 0) > (Number(b && b.size) || 0);
      }
      function qishuiBestStreamCandidate(candidates) {
        let best = null;
        (candidates || []).forEach((item) => {
          if (!item || !item.url) return;
          if (qishuiBetterStreamCandidate(item, best)) best = item;
        });
        return best;
      }
      var QISHUI_TRACK_VIP_KEYS = /* @__PURE__ */ new Set([
        "onlyvipplayable",
        "viprequired",
        "needvip",
        "isvip",
        "isviponly",
        "viponly",
        "onlyvip",
        "onlymemberplayable",
        "memberrequired",
        "needmember",
        "payplay"
      ]);
      var QISHUI_TRACK_SVIP_KEYS = /* @__PURE__ */ new Set([
        "onlysvipplayable",
        "sviprequired",
        "needsvip",
        "issvip",
        "issviponly",
        "sviponly",
        "onlysvip",
        "onlysupervipplayable",
        "superviprequired",
        "needsupervip",
        "issuperviponly",
        "superviponly"
      ]);
      var QISHUI_TRACK_ACCOUNT_CONTAINER_KEYS = /* @__PURE__ */ new Set([
        "membership",
        "membershipinfo",
        "usermembership",
        "accountmembership",
        "account",
        "userinfo",
        "userprofile",
        "me"
      ]);
      var QISHUI_TRACK_DOWNLOAD_CONTAINER_KEYS = /* @__PURE__ */ new Set([
        "downloaddetail",
        "downloadinfo",
        "download_detail",
        "downloadinfo",
        "download",
        "dldetail",
        "dl"
      ]);
      function qishuiTrackPlaybackRestriction(value) {
        let vipRequired = false;
        let svipRequired = false;
        let membershipHintKnown = false;
        let visited = 0;
        const evidence = [];
        const visit = (node, depth, pathKeys) => {
          if (!node || typeof node !== "object" || depth > 7 || visited > 800) return;
          visited += 1;
          if (Array.isArray(node)) {
            node.slice(0, 160).forEach((item) => visit(item, depth + 1, pathKeys));
            return;
          }
          for (const [key, item] of Object.entries(node).slice(0, 180)) {
            const normalizedKey = qishuiNormalizedFieldKey(key);
            const nextPath = pathKeys.concat(normalizedKey);
            if (QISHUI_TRACK_ACCOUNT_CONTAINER_KEYS.has(normalizedKey)) continue;
            if (QISHUI_TRACK_DOWNLOAD_CONTAINER_KEYS.has(normalizedKey)) continue;
            if (QISHUI_TRACK_SVIP_KEYS.has(normalizedKey)) {
              membershipHintKnown = true;
              if (qishuiExplicitPositive(item)) {
                svipRequired = true;
                vipRequired = true;
                evidence.push(nextPath.join("."));
              }
            } else if (QISHUI_TRACK_VIP_KEYS.has(normalizedKey)) {
              membershipHintKnown = true;
              if (qishuiExplicitPositive(item)) {
                vipRequired = true;
                evidence.push(nextPath.join("."));
              }
            } else if (normalizedKey === "fee") {
              membershipHintKnown = true;
              if (Number(item) === 1) {
                vipRequired = true;
                evidence.push(nextPath.join("."));
              }
            } else if (normalizedKey === "privilege") {
              membershipHintKnown = true;
              if (Number(item) >= 9) {
                vipRequired = true;
                evidence.push(nextPath.join("."));
              }
            }
            if (item && typeof item === "object") visit(item, depth + 1, nextPath);
          }
        };
        visit(value, 0, []);
        return {
          vipRequired,
          svipRequired,
          requiredTier: svipRequired ? "svip" : vipRequired ? "vip" : "free",
          membershipHintKnown,
          evidence
        };
      }
      function qishuiTrackRequiresVip(value) {
        return qishuiTrackPlaybackRestriction(value).vipRequired;
      }
      var QISHUI_TIER_RANK = Object.freeze({ free: 0, vip: 1, svip: 2 });
      function qishuiNormalizeRequiredTier(value) {
        const text = normalizeText(value).toLowerCase().replace(/[-_\s]/g, "");
        if (/^(svip|supervip|hires|highres|highresolution|master|atmos|dolby|spatial)$/.test(text)) return "svip";
        if (/^(vip|member|premium|lossless|sq|flac|exhigh|high|higher|highest|hq|320)$/.test(text)) return "vip";
        return "free";
      }
      function qishuiHigherRequiredTier(a, b) {
        a = qishuiNormalizeRequiredTier(a);
        b = qishuiNormalizeRequiredTier(b);
        return QISHUI_TIER_RANK[b] > QISHUI_TIER_RANK[a] ? b : a;
      }
      function qishuiStreamRequiredTier(stream) {
        stream = stream && typeof stream === "object" ? stream : {};
        let requiredTier = qishuiNormalizeRequiredTier(
          stream.requiredTier || stream.required_tier || stream.membershipTier || stream.membership_tier || ""
        );
        const quality = normalizeText(stream.quality || stream.definition || "").toLowerCase().replace(/[-_\s]/g, "");
        const format = normalizeText(stream.format || "").toLowerCase();
        const bitrate = qishuiNormalizeBitrateKbps(stream.bitrate);
        if (/svip|supervip|hires|highres|highresolution|master|atmos|dolby|spatial/.test(quality)) {
          requiredTier = qishuiHigherRequiredTier(requiredTier, "svip");
        } else if (/lossless|flac|sq/.test(quality) || /flac|alac|wav/.test(format) || bitrate >= 900) {
          requiredTier = qishuiHigherRequiredTier(requiredTier, "vip");
        } else if (/highest|excellent|superhigh|high$|hq|exhigh|320/.test(quality) || bitrate > 192) {
          requiredTier = qishuiHigherRequiredTier(requiredTier, "vip");
        }
        return requiredTier;
      }
      function qishuiMembershipTier(membership) {
        if (!(membership && membership.membershipKnown)) return "unknown";
        if (membership.isSvip) return "svip";
        if (membership.isVip) return "vip";
        return "free";
      }
      function qishuiRequiredTierAllowed(requiredTier, membership) {
        requiredTier = qishuiNormalizeRequiredTier(requiredTier);
        if (requiredTier === "free") return true;
        if (!(membership && membership.membershipKnown)) return false;
        if (requiredTier === "svip") return !!membership.isSvip;
        return !!membership.isVip;
      }
      function qishuiStreamAllowedForMembership(stream, membership) {
        if (!stream || !stream.url) return false;
        return qishuiRequiredTierAllowed(qishuiStreamRequiredTier(stream), membership);
      }
      function qishuiBestStreamCandidateForMembership(candidates, membership) {
        return qishuiBestStreamCandidate((candidates || []).filter((item) => qishuiStreamAllowedForMembership(item, membership)));
      }
      function qishuiStreamUrlFrom(value) {
        return normalizeText(qishuiObjectString(value, [
          "main_play_url",
          "MainPlayUrl",
          "main_url",
          "MainUrl",
          "url",
          "URL",
          "play_url",
          "PlayURL",
          "playable_url",
          "PlayableUrl",
          "playableUrl"
        ]) || qishuiObjectString(value, [
          "backup_play_url",
          "BackupPlayUrl",
          "backup_url",
          "BackupUrl",
          "backup_url_1",
          "backup_url_2",
          "backup_url_3"
        ]) || firstUrl(value && (value.backup_urls || value.backupUrls || value.url_list || value.UrlList)));
      }
      function qishuiBitrateFromUrl(value) {
        value = normalizeText(value);
        if (!value) return 0;
        try {
          const parsed = new URL(value);
          for (const key of ["br", "bitrate", "bit_rate", "real_bitrate"]) {
            const bitrate = Number(parsed.searchParams.get(key)) || 0;
            if (bitrate > 0) return bitrate;
          }
        } catch (_) {
        }
        const match = value.match(/(?:^|[/_.-])(\d{2,4})(?:k|kbps)(?:[/_.-]|$)/i);
        return match ? Number(match[1]) || 0 : 0;
      }
      function qishuiBitrateFromSize(size, duration) {
        size = Number(size) || 0;
        duration = qishuiNormalizeDurationSeconds(duration);
        if (size <= 0 || duration <= 0) return 0;
        const bitrate = Math.round(size * 8 / duration);
        return bitrate >= 32e3 && bitrate <= 12e6 ? bitrate : 0;
      }
      function qishuiStreamFromObject(value, inherited) {
        if (!value || typeof value !== "object") return null;
        const url = qishuiStreamUrlFrom(value);
        if (!url) return null;
        inherited = inherited || {};
        const meta = pickObject(value.video_meta, value.VideoMeta, value.meta, value.Meta);
        const size = qishuiObjectNumber(value, ["size", "Size", "file_size", "FileSize", "data_size", "DataSize"]) || qishuiObjectNumber(meta, ["size", "Size", "file_size", "FileSize"]);
        const duration = qishuiNormalizeDurationSeconds(qishuiObjectNumber(value, ["duration", "Duration"]) || inherited.duration || 0);
        const bitrate = qishuiObjectNumber(value, ["bitrate", "Bitrate", "real_bitrate", "RealBitrate", "br", "BR", "bit_rate", "BitRate"]) || qishuiObjectNumber(meta, ["bitrate", "Bitrate", "real_bitrate", "RealBitrate", "bit_rate", "BitRate"]) || qishuiBitrateFromUrl(url) || qishuiBitrateFromSize(size, duration);
        const stream = {
          url,
          auth: qishuiObjectString(value, ["play_auth", "PlayAuth", "spade_a", "SpadeA"]) || qishuiVideoModelPlayAuth(value) || inherited.auth || "",
          size,
          format: qishuiObjectString(value, ["format", "Format", "vtype", "VType", "file_format", "FileFormat"]) || qishuiObjectString(meta, ["format", "Format", "vtype", "VType", "codec_type", "CodecType"]),
          bitrate,
          quality: qishuiObjectString(value, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType"]) || qishuiObjectString(meta, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType"]) || qishuiVideoModelQualityHint(qishuiObjectString(value, ["gear_des_key", "GearDesKey"]) || inherited.keyHint || ""),
          duration
        };
        stream.requiredTier = qishuiStreamRequiredTier(stream);
        return stream;
      }
      function qishuiMaybeParseJson(value) {
        let text = typeof value === "string" ? value.trim() : "";
        if (!text) return value;
        for (let i = 0; i < 3 && text.charAt(0) === '"'; i++) {
          try {
            text = JSON.parse(text);
          } catch (_) {
            break;
          }
          if (typeof text !== "string") return text;
          text = text.trim();
        }
        try {
          return JSON.parse(text);
        } catch (_) {
          return value;
        }
      }
      function qishuiCollectVideoModelStreams(value, keyHint, inherited, out) {
        value = qishuiMaybeParseJson(value);
        inherited = inherited || {};
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach((item) => qishuiCollectVideoModelStreams(item, keyHint, inherited, out));
          return;
        }
        if (typeof value !== "object") return;
        const ownAuth = qishuiVideoModelPlayAuth(value) || inherited.auth || "";
        const ownDuration = qishuiNormalizeDurationSeconds(qishuiObjectNumber(value, ["video_duration", "duration", "Duration"])) || inherited.duration || 0;
        const entry = qishuiStreamFromObject(value, { auth: ownAuth, duration: ownDuration, keyHint });
        if (entry) out.push(entry);
        Object.keys(value).forEach((key) => {
          qishuiCollectVideoModelStreams(value[key], key, { auth: ownAuth, duration: ownDuration }, out);
        });
      }
      function qishuiVideoModelPlayAuth(value) {
        value = value && typeof value === "object" ? value : {};
        const child = pickObject(value.encrypt_info, value.EncryptInfo, value.encryptInfo);
        return qishuiObjectString(child, ["spade_a", "SpadeA", "spadeA", "play_auth", "PlayAuth"]);
      }
      function qishuiVideoModelQualityHint(key) {
        const normalized = normalizeText(key).toLowerCase().replace(/[-_\s]/g, "");
        if (!normalized) return "";
        return ["hires", "spatial", "atmos", "dolby", "lossless", "sq", "flac", "highest", "higher", "standard", "normal"].find((token) => normalized.includes(token)) || "";
      }
      function extractQishuiMediaList(payload) {
        const data = payload && payload.data || payload || {};
        const direct = pickArray(
          data.media_resources,
          data.media_list,
          data.related_media,
          data.medias,
          data.media,
          data.tracks,
          data.track_list,
          data.songs,
          data.items,
          data.list,
          data.result,
          data.song_list,
          data.recommend_media_list
        );
        if (direct.length) return direct;
        const candidates = [];
        function walk(node, depth) {
          if (!node || depth > 4) return;
          if (Array.isArray(node)) {
            const mediaLike = node.filter((item) => item && typeof item === "object" && (item.media || item.track_entity || item.entity || item.base_info || item.id || item.media_id));
            if (mediaLike.length > candidates.length) candidates.splice(0, candidates.length, ...mediaLike);
            node.forEach((item) => walk(item, depth + 1));
          } else if (typeof node === "object") {
            Object.keys(node).slice(0, 80).forEach((key) => walk(node[key], depth + 1));
          }
        }
        walk(data, 0);
        return candidates;
      }
      function qishuiArtists(related, base, display, track, media) {
        const links = pickArray(
          related.artist_links,
          related.artists,
          base.artist_links,
          base.artists,
          display.artist_links,
          display.artists,
          track && track.artists,
          media && media.artists
        );
        const out = [];
        links.forEach((item) => {
          const name = normalizeText(item && (item.name || item.display_name || item.simple_display_name || item.title || item.artist_name));
          if (!name || out.some((a) => a.name === name)) return;
          out.push({
            id: String(item && (item.id || item.artist_id || item.open_id) || ""),
            name,
            mid: String(item && (item.id || item.artist_id || item.open_id) || "")
          });
        });
        const fallback = normalizeText(base.artist_name || display.artist_name || related.artist_name || track && track.artist_name || media && media.artist_name);
        if (fallback && !out.length) {
          fallback.split(/\s*\/\s*|\s*,\s*|\s*&\s*/).forEach((name) => {
            name = normalizeText(name);
            if (name) out.push({ id: "", name, mid: "" });
          });
        }
        return out;
      }
      function qishuiTranslationIsChinese(item, text) {
        const lang = String(item && (item.language || item.lang || item.language_code || item.lang_code) || "").toLowerCase();
        if (/^(zh|cn|zh-cn|zh_cn|zhs|cht|zh-tw|zh_tw|中文|简体|繁体|普通话|汉语)$/.test(lang.trim())) return true;
        return /[\u4e00-\u9fff]/.test(String(text || ""));
      }
      function qishuiLyricPayload(display, track, base, id) {
        const lyricInfo = pickObject(display.lyric_info, track.lyric_info, base.lyric_info);
        const lyricEntity = pickObject(lyricInfo.lyric_entity, lyricInfo.lyric, lyricInfo.original_lyric);
        const lyric = normalizeLyricBody(lyricEntity.content || lyricInfo.content || lyricInfo.lyric || lyricInfo.lyric_text || "");
        const translations = pickArray(lyricInfo.lang_translations, lyricInfo.translations, lyricInfo.translation);
        let tlyric = "";
        let fallbackTlyric = "";
        for (const item of translations) {
          const entity = pickObject(item && item.lyric_entity, item);
          const text = normalizeLyricBody(entity.content || item && (item.content || item.lyric || item.lyric_text));
          if (!text) continue;
          if (qishuiTranslationIsChinese(item, text)) {
            tlyric = text;
            break;
          }
          if (!fallbackTlyric) fallbackTlyric = text;
        }
        if (!tlyric) tlyric = fallbackTlyric;
        cacheQishuiLyric(id, lyric, tlyric, "qishui-openapi-cache");
        return { lyric, tlyric };
      }
      function cacheQishuiLyric(id, lyric, tlyric, source) {
        id = normalizeText(id);
        const primary = qishuiConvertLyric(lyric);
        const translated = qishuiConvertLyric(tlyric);
        lyric = primary.lyric;
        tlyric = translated.lyric;
        if (!id || !lyric && !tlyric) return null;
        const payload = {
          provider: "qishui",
          lyric,
          tlyric,
          yrc: primary.yrc,
          ytlrc: translated.yrc,
          source: source || "qishui-cache",
          cachedAt: Date.now()
        };
        qishuiLyricCache.set(id, payload);
        return payload;
      }
      function mapQishuiMedia(raw, index, query, opts) {
        opts = opts || {};
        raw = raw || {};
        const entity = pickObject(raw.entity, raw.data, raw);
        const media = pickObject(entity.media, raw.media, entity);
        const wrapper = pickObject(entity.track_wrapper, media.track_wrapper, raw.track_wrapper);
        const track = pickObject(wrapper.track, media.track_entity, raw.track_entity, media.track, raw.track, media);
        const base = pickObject(track.base_info, media.base_info, raw.base_info, track);
        const display = pickObject(track.display_info, media.display_info, raw.display_info);
        const related = pickObject(track.related_info, media.related_info, raw.related_info);
        const id = normalizeText(
          base.id || track.id || media.id || raw.id || raw.media_id || raw.item_id || raw.song_id || raw.vid || "qishui-" + index + "-" + query
        );
        const name = normalizeText(base.name || base.title || track.name || track.title || media.name || raw.name || raw.title);
        if (!id || !name) return null;
        const artists = qishuiArtists(related, base, display, track, media);
        const artist = artists.map((a) => a.name).filter(Boolean).join(" / ") || normalizeText(base.author || raw.author || "");
        const albumLink = pickObject(related.album_link, related.album, base.album, display.album, track.album, media.album);
        const album = normalizeText(albumLink.name || albumLink.title || base.album_name || display.album_name || "");
        const albumId = normalizeText(albumLink.id || albumLink.album_id || albumLink.albumId || "");
        const cover = qishuiFirstImageUrl(
          "~c5_375x375.jpg",
          display.cover_url,
          display.url_cover,
          base.cover_url,
          base.url_cover,
          albumLink.cover_url,
          albumLink.url_cover,
          track.url_cover,
          track.cover_url,
          media.cover_url,
          media.url_cover,
          raw.cover_url,
          raw.cover,
          raw.url_cover
        );
        const durationMs = Number(base.duration_ms || base.duration || track.duration_ms || track.duration || media.duration_ms || media.duration || raw.duration || 0) || 0;
        const lyricData = qishuiLyricPayload(display, track, base, id);
        const directPlayable = !!opts.directPlayable;
        return {
          provider: "qishui",
          source: "qishui",
          type: "qishui",
          id,
          providerSongId: id,
          name,
          artist,
          artists,
          album,
          album_id: albumId,
          albumId,
          cover,
          duration: qishuiNormalizeDurationSeconds(durationMs),
          popularity: Number(raw.popularity || raw.hot || raw.heat || raw.play_count || raw.playCount || related.play_count || related.playCount || 0) || 0,
          fee: track.label_info && track.label_info.only_vip_playable ? 1 : 0,
          playable: directPlayable,
          playbackMode: directPlayable ? "direct-url" : "recommend-match",
          recommendationSource: directPlayable ? "qishui-pc-session" : "qishui-openapi",
          qishuiRank: index,
          qishuiQuery: query || "",
          lyric: lyricData.lyric,
          tlyric: lyricData.tlyric,
          restriction: qishuiRestriction("provider_limited", "汽水音乐当前作为推荐/匹配源接入，播放时会自动寻找其它可播版本。", "switch_source")
        };
      }
      function qishuiWebCommonParams(extra, opts) {
        if (opts && opts.noDefaultParams) return Object.assign({}, extra || {});
        return Object.assign({}, QISHUI_WEB_DEFAULT_PARAMS, extra || {});
      }
      function qishuiPcAppParams(extra) {
        const now = Date.now();
        const deviceId = String(now);
        return Object.assign({
          aid: "386088",
          app_name: "luna_pc",
          region: "cn",
          geo_region: "cn",
          os_region: "cn",
          sim_region: "",
          device_id: deviceId,
          cdid: "",
          iid: String(now + 1),
          version_name: "3.3.0",
          version_code: "30030000",
          channel: "official",
          build_mode: "master",
          network_carrier: "",
          ac: "wifi",
          tz_name: "Asia/Shanghai",
          resolution: "",
          device_platform: "windows",
          device_type: "Windows",
          os_version: "Windows 11",
          fp: deviceId
        }, extra || {});
      }
      function qishuiWebHeaders(cookieText, opts) {
        const cookie = opts && opts.sessionOnly ? qishuiSessionCookieHeader(cookieText) : normalizeQishuiCookieInput(cookieText);
        const headers = {
          "Accept": "application/json,text/plain,*/*",
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": opts && opts.pcApp ? QISHUI_PC_APP_UA : QISHUI_WEB_UA
        };
        if (opts && opts.pcApp) {
          headers["x-luna-background-type"] = "foreground";
          headers["x-luna-is-background-req"] = "0";
          headers["x-luna-is-local-user"] = "1";
        }
        if (cookie) headers.Cookie = cookie;
        return headers;
      }
      async function qishuiWebRequestJson(apiPath, params, cookieText, opts) {
        opts = opts || {};
        const bases = Array.isArray(opts.bases) && opts.bases.length ? opts.bases : QISHUI_WEB_API_BASES;
        const method = String(opts.method || "GET").toUpperCase();
        const body = opts.body == null ? null : String(opts.body);
        let lastErr = null;
        for (const base of bases) {
          const target = /^https?:\/\//i.test(apiPath) ? apiPath : String(base || "").replace(/\/+$/, "") + apiPath;
          const targetUrl = urlWithParams(target, qishuiWebCommonParams(params, opts));
          const headers = Object.assign(qishuiWebHeaders(cookieText, opts), opts.headers || {});
          if (opts.referer) headers.Referer = String(opts.referer);
          try {
            const officialBridge = opts.signed === false ? null : getQishuiOfficialBridge();
            let json;
            if (opts.pcApp && officialBridge) {
              let signedResponseBody = "";
              let signedResponseStatus = null;
              try {
                const response = await officialBridge.requestOfficial(method, targetUrl, {
                  headers,
                  body,
                  timeoutMs: opts.timeoutMs || 8e3
                });
                signedResponseBody = response && response.body || "";
                signedResponseStatus = response && response.status;
                try {
                  json = JSON.parse(String(response && response.body || ""));
                } catch (parseError) {
                  const error = new Error("Invalid JSON from Qishui official signed API");
                  error.code = "QISHUI_OFFICIAL_INVALID_JSON";
                  error.cause = parseError;
                  throw error;
                }
              } catch (signedError) {
                lastErr = signedError;
                if (__foliaProcessEnv.QISHUI_DEBUG_SIGNED === "1") {
                  console.warn("[QishuiSignedRequest]", signedError && signedError.code || signedError && signedError.name || "error");
                }
                qishuiDiagLog("signed_request_failed", {
                  code: signedError && signedError.code,
                  message: String(signedError && signedError.message || signedError),
                  body: String(signedResponseBody || "").slice(0, 3e3),
                  status: signedResponseStatus
                });
                json = null;
              }
            }
            if (!json) {
              json = await requestJson(targetUrl, {
                method,
                timeoutMs: opts.timeoutMs || 8e3,
                headers
              }, body);
            }
            const err = qishuiPcStatusError(json, "QISHUI_WEB_REQUEST_FAILED");
            if (err) throw err;
            return json;
          } catch (err) {
            lastErr = err;
            if (err && (err.statusCode === 401 || err.statusCode === 403)) break;
          }
        }
        throw lastErr || new Error("QISHUI_WEB_REQUEST_FAILED");
      }
      async function fetchQishuiPlaybackMembership(cookieText) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) {
          return qishuiUnknownMembership("QISHUI_COOKIE_REQUIRED");
        }
        const cacheKey = "membership|" + qishuiCookieFingerprint(cookie);
        return qishuiMembershipCache.wrap(cacheKey, qishuiMembershipCacheTtlMs, async () => {
          try {
            const json = await qishuiWebRequestJson("/luna/pc/me", qishuiPcAppParams(), cookie, {
              bases: [QISHUI_WEB_PC_API_BASE],
              noDefaultParams: true,
              sessionOnly: true,
              pcApp: true,
              timeoutMs: 6500
            });
            const data = json && json.data || json || {};
            const profile = qishuiProfileFromMeData(data);
            return qishuiApplyMembershipObservation(cacheKey, {
              membershipKnown: !!profile.membershipKnown,
              vipType: Number(profile.vipType) || 0,
              vipLevel: profile.vipLevel || "none",
              isVip: !!profile.isVip,
              isSvip: !!profile.isSvip,
              vipLabel: profile.vipLabel || "无VIP",
              expiresAt: Number(profile.expiresAt) || 0,
              sessionValidated: !!profile.profileReady,
              userId: profile.userId || "",
              entitlementSource: "official-pc-me"
            });
          } catch (err) {
            return qishuiApplyMembershipObservation(
              cacheKey,
              qishuiUnknownMembership(err && err.message || "QISHUI_MEMBERSHIP_CHECK_FAILED")
            );
          }
        });
      }
      function qishuiUnknownMembership(error) {
        return {
          membershipKnown: false,
          membershipStatus: "unknown",
          reason: "membership_unknown",
          vipType: 0,
          vipLevel: "unknown",
          isVip: false,
          isSvip: false,
          vipLabel: "未知会员状态",
          expiresAt: 0,
          sessionValidated: false,
          error: normalizeText(error || "QISHUI_MEMBERSHIP_UNKNOWN")
        };
      }
      function qishuiApplyMembershipObservation(historyKey, membership, now) {
        historyKey = normalizeText(historyKey);
        membership = membership && typeof membership === "object" ? Object.assign({}, membership) : qishuiUnknownMembership("QISHUI_MEMBERSHIP_UNKNOWN");
        now = Number.isFinite(Number(now)) ? Number(now) : Date.now();
        const membershipKnown = !!membership.membershipKnown;
        const expiresAt = Number(membership.expiresAt) || 0;
        const positive = membershipKnown && !!(membership.isVip || membership.isSvip);
        if (membershipKnown) {
          if (historyKey) qishuiMembershipPositiveHistory.delete(historyKey);
          if (positive && expiresAt > now && historyKey) {
            const retainedUntil = Math.min(expiresAt, now + QISHUI_MEMBERSHIP_POSITIVE_GRACE_MS);
            qishuiMembershipPositiveHistory.set(historyKey, {
              membership: Object.assign({}, membership, {
                membershipStatus: membership.isSvip ? "svip" : "vip"
              }),
              observedAt: now,
              expiresAt,
              retainedUntil
            });
            while (qishuiMembershipPositiveHistory.size > 48) {
              const oldestKey = qishuiMembershipPositiveHistory.keys().next().value;
              if (!oldestKey) break;
              qishuiMembershipPositiveHistory.delete(oldestKey);
            }
          }
          return Object.assign(membership, {
            membershipStatus: positive ? membership.isSvip ? "svip" : "vip" : "free"
          });
        }
        const previous = historyKey ? qishuiMembershipPositiveHistory.get(historyKey) : null;
        if (previous && previous.expiresAt > now && previous.retainedUntil > now && previous.membership && previous.membership.membershipKnown) {
          return Object.assign({}, previous.membership, {
            retainedOfficialPositive: true,
            retainedUntil: previous.retainedUntil,
            entitlementSource: "recent-official-positive",
            membershipCheckError: membership.error || membership.reason || "membership_unknown"
          });
        }
        if (previous && historyKey) qishuiMembershipPositiveHistory.delete(historyKey);
        return Object.assign(qishuiUnknownMembership(membership.error || membership.reason), membership, {
          membershipKnown: false,
          membershipStatus: "unknown",
          reason: "membership_unknown",
          vipType: 0,
          vipLevel: "unknown",
          isVip: false,
          isSvip: false,
          vipLabel: "未知会员状态",
          expiresAt: 0
        });
      }
      function qishuiMembershipCacheTtlMs(membership, now) {
        now = Number.isFinite(Number(now)) ? Number(now) : Date.now();
        if (!(membership && membership.membershipKnown)) return 1;
        if (!(membership.isVip || membership.isSvip)) return QISHUI_MEMBERSHIP_POSITIVE_CACHE_MS;
        const expiresAt = Number(membership && membership.expiresAt) || 0;
        if (expiresAt <= 0) return 1;
        let remainingMs = expiresAt - now;
        const retainedUntil = Number(membership.retainedUntil) || 0;
        if (retainedUntil > 0) remainingMs = Math.min(remainingMs, retainedUntil - now);
        if (remainingMs <= 0) return 1;
        return Math.max(1, Math.min(QISHUI_MEMBERSHIP_POSITIVE_CACHE_MS, remainingMs - 250));
      }
      async function qishuiPcPostJson(apiPath, payload, cookieText, opts) {
        opts = opts || {};
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) {
          const err = new Error("QISHUI_COOKIE_REQUIRED");
          err.code = "QISHUI_COOKIE_REQUIRED";
          throw err;
        }
        const body = JSON.stringify(payload || {});
        const json = await qishuiWebRequestJson(apiPath, qishuiPcAppParams(opts.params), cookie, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          method: "POST",
          body,
          referer: "https://www.qishui.com/",
          timeoutMs: opts.timeoutMs || 9e3
        });
        const statusError = qishuiPcStatusError(json, opts.errorCode || "QISHUI_PC_WRITE_FAILED");
        if (statusError) throw statusError;
        return json;
      }
      function invalidateQishuiLibraryCaches() {
        qishuiWebLibraryCache.clear();
        qishuiWebPlaylistCache.clear();
        qishuiWebPlaylistCursorCache.clear();
      }
      function dedupeQishuiSongs(songs) {
        const seen = /* @__PURE__ */ new Set();
        const out = [];
        (songs || []).forEach((song) => {
          if (!song || !song.id) return;
          const key = String(song.providerSongId || song.id);
          if (seen.has(key)) return;
          seen.add(key);
          out.push(song);
        });
        return out;
      }
      function mapQishuiMediaList(rawItems, query, opts) {
        return dedupeQishuiSongs((rawItems || []).map((item, index) => mapQishuiMedia(item, index, query, opts)).filter(Boolean));
      }
      function qishuiPlaylistLikeName(name) {
        const text = String(name || "");
        return /喜欢|收藏|favorite|liked/i.test(text) || text.indexOf("喜欢") >= 0 || text.indexOf("收藏") >= 0;
      }
      function qishuiPlaylistPrimaryLikeName(name) {
        const text = String(name || "");
        return /favorite|liked/i.test(text) || text.indexOf("喜欢") >= 0;
      }
      function qishuiPlaylistIdFromItem(item) {
        item = item || {};
        return normalizeText(
          item.playlist_id || item.playlistId || item.collection_id || item.collectionId || item.id || item.item_id || item.resource_id || item.object_id || item.server_id || ""
        );
      }
      function qishuiPlaylistNameFromItem(item) {
        item = item || {};
        return normalizeText(
          item.title || item.public_title || item.publicTitle || item.name || item.display_title || item.display_name || item.playlist_name || item.collection_name || ""
        );
      }
      function qishuiPlaylistCoverFromItem(item) {
        item = item || {};
        return qishuiFirstImageUrl(
          "~c5_300x300.jpg",
          item.cover_url,
          item.cover,
          item.cover_uri,
          item.image,
          item.image_url,
          item.url_cover,
          item.icon,
          item.avatar
        );
      }
      function qishuiPlaylistTrackCountFromItem(item) {
        item = item || {};
        return Number(
          item.count_tracks || item.track_count || item.media_count || item.count || item.total || item.song_count || 0
        ) || 0;
      }
      function extractQishuiPlaylistCards(payload) {
        const data = payload && payload.data || payload || {};
        const out = [];
        const seen = /* @__PURE__ */ new Set();
        function visit(node, depth) {
          if (!node || depth > 6) return;
          if (Array.isArray(node)) {
            node.forEach((item) => visit(item, depth + 1));
            return;
          }
          if (typeof node !== "object") return;
          const candidates = [
            node.playlist,
            node.playlist_info,
            node.collection,
            node.collect_playlist,
            node.fav_playlist,
            node.resource,
            node
          ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
          candidates.forEach((item) => {
            const id = qishuiPlaylistIdFromItem(item);
            const name = qishuiPlaylistNameFromItem(item);
            const count = qishuiPlaylistTrackCountFromItem(item);
            const type = normalizeText(item.type || item.card_type || item.resource_type || node.type || "");
            if (!id || !name) return;
            if (!count && !qishuiPlaylistLikeName(name) && !/playlist|collection|fav|songlist|歌单/i.test(type + " " + name)) return;
            const key = id + "|" + name;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
              provider: "qishui",
              source: "qishui",
              type: "playlist",
              id,
              name,
              cover: qishuiPlaylistCoverFromItem(item),
              trackCount: count,
              playCount: Number(item.play_count || item.playCount || 0) || 0,
              creator: normalizeText(item.creator_name || item.author_name || item.owner_name || item.owner && (item.owner.nickname || item.owner.public_name) || "汽水音乐"),
              subscribed: true,
              virtual: false,
              webSession: true,
              isLiked: qishuiPlaylistLikeName(name),
              playbackMode: "recommend-match"
            });
          });
          Object.keys(node).slice(0, 80).forEach((key) => visit(node[key], depth + 1));
        }
        visit(data, 0);
        return out;
      }
      function buildQishuiVirtualPlaylist(id, name, songs, extra) {
        songs = Array.isArray(songs) ? songs : [];
        extra = extra || {};
        return {
          provider: "qishui",
          source: "qishui",
          type: "playlist",
          id,
          name,
          cover: extra.cover || songs.map((song) => song && song.cover).find(Boolean) || "",
          trackCount: Number(extra.trackCount || songs.length || 0) || 0,
          playCount: Number(extra.playCount || 0) || 0,
          creator: extra.creator || "汽水音乐",
          subscribed: !!extra.subscribed,
          shelfPane: extra.shelfPane || "",
          owned: !!extra.owned,
          virtual: true,
          webSession: !!extra.webSession,
          playbackMode: "recommend-match"
        };
      }
      async function fetchQishuiWebFeedSongs(cookieText, limit) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) return { provider: "qishui", configured: false, webSession: false, songs: [], error: "QISHUI_COOKIE_REQUIRED" };
        limit = Math.max(1, Math.min(50, Number(limit) || 8));
        const cacheKey = "web-feed|" + qishuiCookieFingerprint(cookie) + "|" + limit;
        return qishuiFeedCache.wrap(cacheKey, 90 * 1e3, async () => {
          const candidates = [
            { path: "/luna/feed/song-tab", params: { cursor: 0, cnt: limit, count: limit } },
            { path: "/luna/pc/feed/song-tab", params: { cursor: 0, cnt: limit, count: limit } }
          ];
          let lastErr = null;
          for (const item of candidates) {
            try {
              const json = await qishuiWebRequestJson(item.path, item.params, cookie, { timeoutMs: 8e3 });
              const rawItems = extractQishuiMediaList(json);
              const songs = mapQishuiMediaList(rawItems, "web-feed", { directPlayable: true }).slice(0, limit);
              if (songs.length) return { provider: "qishui", configured: true, webSession: true, songs, rawCount: rawItems.length };
            } catch (err) {
              lastErr = err;
            }
          }
          try {
            const fallback = await fetchQishuiWebLibraryFeedFallback(cookie, limit);
            if (fallback && fallback.songs && fallback.songs.length) return fallback;
          } catch (fallbackErr) {
            lastErr = fallbackErr || lastErr;
          }
          return { provider: "qishui", configured: true, webSession: true, songs: [], rawCount: 0, error: lastErr && lastErr.message || "" };
        });
      }
      async function fetchQishuiWebLibraryFeedFallback(cookieText, limit) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        limit = Math.max(1, Math.min(50, Number(limit) || 8));
        const library = await fetchQishuiWebLibrary(cookie);
        let songs = dedupeQishuiSongs([].concat(library.likedTracks || []).concat(library.recentTracks || []));
        const detailCandidates = [].concat(library.likedCard ? [library.likedCard] : []).concat((library.playlists || []).filter((pl) => pl && pl.id));
        for (let i = 0; songs.length < limit && i < detailCandidates.length && i < 4; i += 1) {
          const pl = detailCandidates[i];
          if (!pl || !pl.id) continue;
          try {
            const detail = await fetchQishuiWebPlaylistTracks(pl.id, cookie, { limit: Math.max(limit, 12), offset: 0 });
            songs = dedupeQishuiSongs(songs.concat(detail && detail.tracks || []));
          } catch (_) {
          }
        }
        songs = songs.slice(0, limit);
        return {
          provider: "qishui",
          configured: true,
          webSession: true,
          songs,
          rawCount: songs.length,
          source: "qishui-web-library-fallback",
          fallback: true,
          error: songs.length ? "" : (library.errors || []).join("; ") || "QISHUI_WEB_FEED_EMPTY"
        };
      }
      async function fetchQishuiWebLibrary(cookieText) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) {
          return { provider: "qishui", loggedIn: false, webSession: false, playlists: [], likedTracks: [], recentTracks: [] };
        }
        const cacheKey = "library|" + qishuiCookieFingerprint(cookie);
        return qishuiWebLibraryCache.wrap(cacheKey, 90 * 1e3, async () => {
          const playlists = [];
          const likedTracks = [];
          const recentTracks = [];
          const cardTracks = [];
          const errors = [];
          const addSongs = (target, songs) => {
            target.push(...dedupeQishuiSongs(songs || []));
          };
          const tryRead = async (label, apiPath, params, requestOpts) => {
            requestOpts = requestOpts || {};
            try {
              const json = await qishuiWebRequestJson(apiPath, params || {}, cookie, Object.assign({
                bases: [QISHUI_WEB_PC_API_BASE],
                noDefaultParams: true,
                sessionOnly: true,
                timeoutMs: 6500
              }, requestOpts));
              if (/created|collection|collect/i.test(label)) {
                extractQishuiPlaylistCards(json).forEach((pl) => {
                  const primaryLike = qishuiPlaylistPrimaryLikeName(pl && pl.name);
                  if (/created/i.test(label) || primaryLike) {
                    pl.shelfPane = "mine";
                    pl.owned = true;
                    pl.subscribed = false;
                  } else {
                    pl.shelfPane = "fav";
                    pl.owned = false;
                    pl.subscribed = true;
                  }
                  playlists.push(pl);
                });
              }
              const songs = mapQishuiMediaList(extractQishuiMediaList(json), label, { directPlayable: true });
              if (/recent/i.test(label)) addSongs(recentTracks, songs);
              else if (/liked|favorite|collect/i.test(label)) addSongs(likedTracks, songs);
              else addSongs(cardTracks, songs);
              return json;
            } catch (err) {
              if (!requestOpts.optional) errors.push(label + ":" + (err && err.message || "failed"));
              return null;
            }
          };
          const pcRequestOpts = { pcApp: true };
          const meJson = await tryRead("me", "/luna/pc/me", qishuiPcAppParams(), pcRequestOpts);
          const meData = meJson && meJson.data || meJson || {};
          const profile = qishuiProfileFromMeData(meData);
          const userId = profile.userId;
          await Promise.all([
            userId ? tryRead("created", "/luna/pc/user/playlist", qishuiPcAppParams({
              user_id: userId,
              cursor: "",
              count: 50
            }), pcRequestOpts) : Promise.resolve(null),
            tryRead("collection", "/luna/pc/me/collection/mixed", qishuiPcAppParams({
              cursor: "",
              count: 50
            }), Object.assign({ optional: true }, pcRequestOpts)),
            tryRead("recent", "/luna/pc/me/recently-played-media", qishuiPcAppParams({
              cursor: "",
              count: 50
            }), Object.assign({ optional: true }, pcRequestOpts))
          ]);
          if (!userId) errors.push("me:missing-user-id");
          const uniquePlaylists = [];
          const seenPlaylists = /* @__PURE__ */ new Set();
          playlists.forEach((pl) => {
            if (!pl || !pl.id || seenPlaylists.has(pl.id)) return;
            seenPlaylists.add(pl.id);
            uniquePlaylists.push(pl);
          });
          const likedCard = uniquePlaylists.find((pl) => pl && pl.isLiked && qishuiPlaylistPrimaryLikeName(pl.name)) || uniquePlaylists.find((pl) => pl && pl.isLiked);
          return {
            provider: "qishui",
            loggedIn: true,
            configured: true,
            webSession: true,
            playlists: uniquePlaylists,
            likedCard,
            likedTracks: dedupeQishuiSongs(likedTracks),
            recentTracks: dedupeQishuiSongs(recentTracks),
            profile,
            errors
          };
        });
      }
      async function handleQishuiStatus(cookieText) {
        const status = getQishuiStatus(cookieText);
        if (!status.webSession) return status;
        try {
          const library = await fetchQishuiWebLibrary(cookieText);
          const profile = library && library.profile || {};
          if (profile.profileReady) {
            status.userId = profile.userId || status.userId;
            status.nickname = profile.nickname || status.nickname;
            status.avatar = profile.avatar || status.avatar;
            status.douyinId = profile.douyinId || "";
            status.vipType = profile.vipType || 0;
            status.vipLevel = profile.vipLevel || "none";
            status.isVip = !!profile.isVip;
            status.isSvip = !!profile.isSvip;
            status.vipLabel = profile.vipLabel || (status.vipLevel === "svip" ? "SVIP" : status.vipLevel === "vip" ? "VIP" : "无VIP");
            status.membershipKnown = !!profile.membershipKnown;
            status.profileReady = true;
          }
          status.libraryReady = true;
          status.libraryErrors = library && library.errors || [];
        } catch (err) {
          status.profileReady = false;
          status.profileError = err && err.message || "QISHUI_PROFILE_FAILED";
        }
        return status;
      }
      async function fetchQishuiWebPlaylistTracks(playlistId, cookieText, opts) {
        opts = opts || {};
        const cookie = normalizeQishuiCookieInput(cookieText);
        const id = normalizeText(String(playlistId || "").replace(/^qishui:/i, ""));
        if (!qishuiCookieHasLogin(cookie) || !id) {
          return { provider: "qishui", configured: false, webSession: false, tracks: [], total: 0, error: "QISHUI_COOKIE_REQUIRED" };
        }
        const limit = Math.max(1, Math.min(50, Number(opts.limit) || 50));
        const offset = Math.max(0, Number(opts.offset) || 0);
        const cacheKey = "playlist|" + qishuiCookieFingerprint(cookie) + "|" + id + "|" + limit + "|" + offset;
        return qishuiWebPlaylistCache.wrap(cacheKey, 90 * 1e3, async () => {
          const targetCount = offset + limit;
          const cursorKey = qishuiCookieFingerprint(cookie) + "|" + id;
          let cursorState = qishuiWebPlaylistCursorCache.get(cursorKey);
          if (!cursorState || Date.now() - cursorState.updatedAt > 10 * 60 * 1e3) {
            cursorState = { rawItems: [], cursor: "", hasMore: true, lastJson: null, updatedAt: Date.now(), promise: null };
            qishuiWebPlaylistCursorCache.set(cursorKey, cursorState);
          }
          while (cursorState.rawItems.length < targetCount && cursorState.hasMore) {
            if (!cursorState.promise) {
              cursorState.promise = qishuiWebRequestJson("/luna/pc/playlist/detail", qishuiPcAppParams({
                playlist_id: id,
                cursor: cursorState.cursor,
                count: Math.min(100, Math.max(1, targetCount - cursorState.rawItems.length))
              }), cookie, {
                bases: [QISHUI_WEB_PC_API_BASE],
                noDefaultParams: true,
                sessionOnly: true,
                pcApp: true,
                timeoutMs: 9e3
              }).then((json) => {
                cursorState.lastJson = json;
                const pageRawItems = extractQishuiMediaList(json);
                cursorState.rawItems.push(...pageRawItems);
                const pageData = json && json.data || json || {};
                const nextCursor = normalizeText(pageData.next_cursor || pageData.nextCursor || json && json.next_cursor || "");
                cursorState.cursor = nextCursor;
                cursorState.hasMore = !!(pageData.has_more || pageData.hasMore || json && json.has_more) && !!nextCursor;
                cursorState.updatedAt = Date.now();
                if (!pageRawItems.length) cursorState.hasMore = false;
              }).finally(() => {
                cursorState.promise = null;
              });
            }
            await cursorState.promise;
          }
          while (qishuiWebPlaylistCursorCache.size > 12) qishuiWebPlaylistCursorCache.delete(qishuiWebPlaylistCursorCache.keys().next().value);
          const allRawItems = cursorState.rawItems;
          const lastJson = cursorState.lastJson;
          const upstreamHasMore = cursorState.hasMore;
          const data = lastJson && lastJson.data || lastJson || {};
          const meta = pickObject(data.playlist, lastJson && lastJson.playlist, data.playlist_info, lastJson && lastJson.playlist_info);
          const playlistCover = qishuiPlaylistCoverFromItem(meta);
          const allTracks = mapQishuiMediaList(allRawItems, "web-playlist", { directPlayable: true }).map((song) => song && !song.cover && playlistCover ? Object.assign({}, song, { cover: playlistCover }) : song);
          const tracks = allTracks.slice(offset, offset + limit);
          const total = Number(meta.count_tracks || meta.track_count || data.total || data.count || data.total_num || allRawItems.length || allTracks.length) || allTracks.length;
          const playlist = buildQishuiVirtualPlaylist(id, qishuiPlaylistNameFromItem(meta) || "汽水歌单", tracks, {
            cover: playlistCover,
            trackCount: total,
            subscribed: true,
            webSession: true
          });
          playlist.virtual = false;
          return {
            provider: "qishui",
            loggedIn: true,
            configured: true,
            webSession: true,
            playlist,
            tracks,
            total,
            offset,
            limit,
            nextOffset: offset + tracks.length,
            hasMore: upstreamHasMore || offset + tracks.length < total,
            rawCount: allRawItems.length
          };
        });
      }
      function mapQishuiPublicItem(raw, index, query) {
        raw = raw || {};
        const author = pickObject(raw.author_info, raw.author, raw.artist);
        const album = pickObject(raw.album_info, raw.album);
        const id = normalizeText(raw.item_id || raw.id || raw.song_id || raw.music_id || "qishui-public-" + index + "-" + query);
        const name = normalizeText(raw.title || raw.name || raw.song_name);
        if (!id || !name) return null;
        const artistName = normalizeText(author.name || raw.author_name || raw.artist_name || raw.singer || "");
        const lyricInfo = pickObject(raw.lyric_info, raw.lyric);
        const lyric = normalizeLyricBody(lyricInfo.lyric_text || lyricInfo.content || lyricInfo.lyric || raw.lyric_text || "");
        cacheQishuiLyric(id, lyric, "", "qishui-public-search-cache");
        return {
          provider: "qishui",
          source: "qishui",
          type: "qishui",
          id,
          providerSongId: id,
          name,
          artist: artistName,
          artists: artistName ? [{ id: normalizeText(author.id || author.author_id), name: artistName, mid: normalizeText(author.id || author.author_id) }] : [],
          album: normalizeText(album.name || raw.album_name || ""),
          cover: firstUrl(raw.cover_url || raw.cover || raw.artwork || album.cover_url),
          duration: Number(raw.duration || raw.duration_ms || 0) > 1e4 ? Math.round(Number(raw.duration || raw.duration_ms) / 1e3) : Number(raw.duration || raw.duration_ms || 0) || 0,
          fee: raw.qishui_label_info && raw.qishui_label_info.only_vip_playable ? 1 : 0,
          playable: false,
          playbackMode: "recommend-match",
          recommendationSource: "qishui-public-catalog",
          qishuiRank: index,
          qishuiQuery: query || "",
          lyric,
          tlyric: "",
          restriction: qishuiRestriction("provider_limited", "汽水音乐当前作为搜索/匹配源接入，播放时会自动寻找其它可播版本。", "switch_source")
        };
      }
      function qishuiSearchComparable(value) {
        return normalizeText(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
      }
      function qishuiPublicSearchScore(song, keywords) {
        song = song || {};
        const query = qishuiSearchComparable(keywords);
        if (!query) return 0;
        const name = qishuiSearchComparable(song.name);
        const artist = qishuiSearchComparable(song.artist);
        const album = qishuiSearchComparable(song.album);
        let score = 0;
        if (name === query) score += 180;
        else if (name.includes(query)) score += 120;
        else if (name && query.includes(name) && name.length >= 2) score += 70;
        if (artist === query) score += 150;
        else if (artist.includes(query)) score += 105;
        if (album === query) score += 80;
        else if (album.includes(query)) score += 45;
        const tokens = normalizeText(keywords).split(/\s+/).map(qishuiSearchComparable).filter((token) => token.length >= 2);
        tokens.forEach((token) => {
          if (name.includes(token)) score += 28;
          if (artist.includes(token)) score += 22;
          if (album.includes(token)) score += 10;
        });
        return score;
      }
      function rankQishuiPublicSongs(songs, keywords, limit) {
        const scored = (Array.isArray(songs) ? songs : []).map((song, index) => ({
          song,
          index,
          score: qishuiPublicSearchScore(song, keywords)
        }));
        const matched = scored.filter((item) => item.score > 0);
        const source = matched.length ? matched : scored;
        return source.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(1, Number(limit) || 8)).map((item) => item.song);
      }
      async function handleQishuiPublicSearch(keywords, limit, cookieText, offset) {
        offset = Math.max(0, Number(offset) || 0);
        const requestLimit = Math.min(100, Math.max(offset + (Number(limit) * 3 || 0), 36));
        const url = urlWithParams(QISHUI_PUBLIC_SEARCH_URL, {
          keyword: keywords,
          search_type: "music",
          limit: requestLimit,
          // The public catalogue endpoint currently repeats nearly the same first
          // page for non-zero real_offset. Fetch a bounded candidate window once and
          // paginate the locally ranked set so scroll loading never loops duplicates.
          real_offset: 0,
          search_source: "qishui"
        });
        const json = await requestJson(url, { timeoutMs: 8e3, headers: QISHUI_PUBLIC_HEADERS });
        const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : [];
        const mappedSongs = list.map((item, index) => mapQishuiPublicItem(item, index, keywords)).filter(Boolean);
        const rankedSongs = rankQishuiPublicSongs(mappedSongs, keywords, requestLimit);
        const songs = rankedSongs.slice(offset, offset + limit);
        const status = getQishuiStatus(cookieText);
        return {
          provider: "qishui",
          configured: status.configured,
          loggedIn: status.loggedIn,
          webSession: status.webSession,
          publicCatalog: true,
          songs,
          rawCount: list.length,
          offset,
          limit,
          nextOffset: offset + songs.length,
          hasMore: songs.length >= limit && (offset + songs.length < rankedSongs.length || requestLimit < 100),
          message: songs.length ? "" : "汽水公开搜索暂时没有返回匹配结果。"
        };
      }
      async function fetchQishuiPublicDetail(id) {
        id = normalizeText(id);
        if (!id) return null;
        return qishuiPublicDetailCache.wrap(id, 30 * 60 * 1e3, async () => {
          const url = urlWithParams(QISHUI_PUBLIC_CONTENTS_URL, {
            sources: "qishui",
            need_author: true,
            need_album: true,
            need_ugc: true,
            need_stat: true,
            item_ids: id
          });
          const json = await requestJson(url, { timeoutMs: 8e3, headers: QISHUI_PUBLIC_HEADERS });
          const item = json && json.data && Array.isArray(json.data.list) ? json.data.list[0] : null;
          if (!item) return null;
          const lyricInfo = pickObject(item.lyric_info, item.lyric);
          const lyric = normalizeLyricBody(
            lyricInfo.lyric_text || lyricInfo.content || lyricInfo.lyric || lyricInfo.lyric_entity && lyricInfo.lyric_entity.content || ""
          );
          const tlyric = normalizeLyricBody(lyricInfo.translated_lyric || lyricInfo.translation || lyricInfo.tlyric || "");
          cacheQishuiLyric(id, lyric, tlyric, "qishui-public-detail");
          return { item, lyric, tlyric };
        });
      }
      function extractQishuiPcSearchItems(payload) {
        const data = payload && payload.data || payload || {};
        const groups = pickArray(
          data.result_groups,
          data.resultGroups,
          data.search_result && data.search_result.result_groups,
          payload && payload.result_groups
        );
        const items = [];
        groups.forEach((group) => {
          const groupData = group && (group.data || group.items || group.list || group.result);
          if (Array.isArray(groupData)) items.push(...groupData);
          else items.push(...extractQishuiMediaList(groupData));
        });
        return items.length ? items : extractQishuiMediaList(data);
      }
      async function handleQishuiPcSearch(keywords, limit, cookieText, offset) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) throw new Error("QISHUI_COOKIE_REQUIRED");
        const requestCount = Math.max(1, Math.min(50, Number(limit) || 8));
        offset = Math.max(0, Number(offset) || 0);
        const json = await qishuiWebRequestJson("/luna/pc/search/track", qishuiPcAppParams({
          q: keywords,
          cursor: String(offset),
          count: requestCount,
          search_method: "input"
        }), cookie, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          timeoutMs: 8500
        });
        const rawItems = extractQishuiPcSearchItems(json);
        const songs = mapQishuiMediaList(rawItems, keywords, { directPlayable: true }).slice(0, limit);
        const data = json && json.data || json || {};
        const resultData = pickObject(data.search_result, data.searchResult, data);
        const nextCursor = normalizeText(
          resultData.next_cursor || resultData.nextCursor || data.next_cursor || data.nextCursor || ""
        );
        const hasMoreFlag = resultData.has_more;
        const hasMore = typeof hasMoreFlag === "boolean" ? hasMoreFlag : Number(hasMoreFlag) > 0 || !!nextCursor || songs.length >= limit;
        return {
          provider: "qishui",
          configured: true,
          loggedIn: true,
          webSession: true,
          source: "qishui-pc-search",
          songs,
          rawCount: rawItems.length,
          offset,
          limit,
          nextOffset: offset + songs.length,
          nextCursor,
          hasMore
        };
      }
      async function handleQishuiSearch(keywords, limit, cookieText, offset) {
        keywords = normalizeText(keywords);
        limit = Math.max(1, Math.min(18, Number(limit) || 8));
        offset = Math.max(0, Number(offset) || 0);
        const status = getQishuiStatus(cookieText);
        if (!keywords) return { provider: "qishui", songs: [], configured: status.configured, message: status.message };
        if (!status.webSession && !status.tokenConfigured && !QISHUI_PUBLIC_ENABLED) {
          return {
            provider: "qishui",
            configured: false,
            songs: [],
            error: "QISHUI_TOKEN_REQUIRED",
            reason: "missing_access_token",
            message: status.message
          };
        }
        const cacheKey = keywords.toLowerCase() + "|" + limit + "|" + offset + "|" + (status.webSession ? qishuiCookieFingerprint(cookieText) : status.tokenConfigured ? "token" : "public");
        return qishuiSearchCache.wrap(cacheKey, 2 * 60 * 1e3, async () => {
          let pcSearchError = "";
          if (status.webSession) {
            try {
              return await handleQishuiPcSearch(keywords, limit, cookieText, offset);
            } catch (err) {
              pcSearchError = err && err.message || String(err);
            }
          }
          if (!status.tokenConfigured || offset > 0) {
            if (!QISHUI_PUBLIC_ENABLED) {
              const err = new Error(pcSearchError || "QISHUI_SEARCH_UNAVAILABLE");
              err.code = "QISHUI_SEARCH_UNAVAILABLE";
              throw err;
            }
            const fallback = await handleQishuiPublicSearch(keywords, limit, cookieText, offset);
            if (pcSearchError) fallback.pcSearchError = pcSearchError;
            return fallback;
          }
          const payload = {
            search_query: keywords,
            played_media: [],
            count: limit,
            common_params: {
              trigger_name: "mineradio_search",
              scene: "search",
              source: "mineradio"
            }
          };
          try {
            const json = await qishuiPost(QISHUI_RELATED_MEDIA_PATH, payload);
            const rawItems = extractQishuiMediaList(json);
            const songs = rawItems.map((item, index) => mapQishuiMedia(item, index, keywords)).filter(Boolean).slice(0, limit);
            return {
              provider: "qishui",
              configured: true,
              songs,
              rawCount: rawItems.length,
              offset,
              limit,
              nextOffset: songs.length,
              hasMore: rawItems.length >= limit,
              pcSearchError
            };
          } catch (err) {
            if (!QISHUI_PUBLIC_ENABLED) throw err;
            const fallback = await handleQishuiPublicSearch(keywords, limit, cookieText, offset);
            fallback.officialError = err && err.message || String(err);
            if (pcSearchError) fallback.pcSearchError = pcSearchError;
            return fallback;
          }
        });
      }
      function qishuiArtistNames(song) {
        song = song || {};
        const names = [];
        const artists = Array.isArray(song.artists) ? song.artists : [];
        artists.forEach((artist) => {
          const name = normalizeText(artist && (artist.name || artist.display_name || artist.title));
          if (name && !names.includes(name)) names.push(name);
        });
        const fallback = normalizeText(song.artist || "");
        fallback.split(/\s*\/\s*|\s*,\s*|、|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+/i).forEach((name) => {
          name = normalizeText(name);
          if (name && !names.includes(name)) names.push(name);
        });
        return names;
      }
      function qishuiArtistSongMatches(song, artistId, artistName) {
        song = song || {};
        const targetId = normalizeText(artistId);
        const targetName = qishuiSearchComparable(artistName);
        const artists = Array.isArray(song.artists) ? song.artists : [];
        const ids = artists.map((artist) => normalizeText(artist && (artist.id || artist.artist_id || artist.mid))).filter(Boolean);
        if (targetId) {
          if (ids.some((id) => id === targetId)) return true;
          if (ids.length) return false;
        }
        if (!targetName) return !targetId;
        return qishuiArtistNames(song).some((name) => {
          const comparable = qishuiSearchComparable(name);
          return comparable === targetName || comparable.includes(targetName) || targetName.includes(comparable);
        });
      }
      async function handleQishuiArtistDetail(opts, cookieText) {
        opts = opts || {};
        const artistId = normalizeText(opts.artistId || opts.id || opts.mid || "");
        const artistName = normalizeText(opts.artistName || opts.name || "");
        const limit = Math.max(10, Math.min(50, parseInt(opts.limit || "36", 10) || 36));
        if (!artistId && !artistName) {
          return { provider: "qishui", error: "MISSING_ARTIST_ID_OR_NAME", artist: null, songs: [] };
        }
        if (!artistName) {
          return { provider: "qishui", error: "MISSING_ARTIST_NAME", artist: { provider: "qishui", id: artistId, name: "" }, songs: [] };
        }
        const pageSize = 18;
        const maxPages = Math.min(5, Math.max(1, Math.ceil(limit / pageSize) + 1));
        const seen = /* @__PURE__ */ new Set();
        const matches = [];
        let offset = 0;
        let pages = 0;
        let source = "";
        let lastError = "";
        let hasMore = false;
        for (let page = 0; page < maxPages; page += 1) {
          let result;
          try {
            result = await handleQishuiSearch(artistName, pageSize, cookieText, offset);
          } catch (err) {
            lastError = err && err.message || String(err);
            break;
          }
          pages += 1;
          source = source || normalizeText(result && (result.source || (result.publicCatalog ? "qishui-public-catalog" : "")));
          if (result && result.error && !lastError) lastError = normalizeText(result.error);
          const pageSongs = Array.isArray(result && result.songs) ? result.songs : [];
          pageSongs.forEach((song) => {
            const id = normalizeText(song && (song.providerSongId || song.id || song.songId));
            if (!id || seen.has(id) || !qishuiArtistSongMatches(song, artistId, artistName)) return;
            seen.add(id);
            matches.push(song);
          });
          hasMore = !!(result && result.hasMore);
          if (!hasMore || !pageSongs.length) break;
          const nextOffset = Number(result.nextOffset);
          if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
          offset = nextOffset;
        }
        const ranked = matches.map((song, index) => ({ song, index })).sort((a, b) => {
          const popularityDiff = (Number(b.song && b.song.popularity) || 0) - (Number(a.song && a.song.popularity) || 0);
          return popularityDiff || a.index - b.index;
        }).map((item) => item.song).slice(0, limit);
        const firstArtist = ranked.reduce((found, song) => {
          if (found) return found;
          const artists = Array.isArray(song && song.artists) ? song.artists : [];
          return artists.find((artist) => {
            const id = normalizeText(artist && (artist.id || artist.artist_id || artist.mid));
            const name = qishuiSearchComparable(artist && artist.name);
            return artistId && id === artistId || !artistId && name === qishuiSearchComparable(artistName);
          }) || null;
        }, null);
        const status = getQishuiStatus(cookieText);
        const output = {
          provider: "qishui",
          configured: !!status.configured,
          loggedIn: !!status.loggedIn,
          webSession: !!status.webSession,
          source: "qishui-artist-search",
          searchSource: source || "qishui-search",
          ordering: matches.some((song) => Number(song && song.popularity) > 0) ? "popularity" : "search-order",
          artist: {
            provider: "qishui",
            id: normalizeText(firstArtist && (firstArtist.id || firstArtist.artist_id || firstArtist.mid)) || artistId,
            name: normalizeText(firstArtist && firstArtist.name) || artistName,
            avatar: ""
          },
          songs: ranked,
          total: ranked.length,
          searchedPages: pages,
          hasMore
        };
        if (!ranked.length && lastError) {
          output.error = "QISHUI_ARTIST_SEARCH_FAILED";
          output.message = lastError;
        }
        return output;
      }
      async function fetchQishuiFeedSongs(limit, cookieText) {
        limit = Math.max(1, Math.min(50, Number(limit) || 8));
        const status = getQishuiStatus(cookieText);
        if (!status.tokenConfigured && status.webSession) return fetchQishuiWebFeedSongs(cookieText, limit);
        if (!status.tokenConfigured) return { provider: "qishui", configured: false, songs: [], error: "QISHUI_TOKEN_REQUIRED", message: status.message };
        const cacheKey = "feed|" + limit;
        return qishuiFeedCache.wrap(cacheKey, 90 * 1e3, async () => {
          const json = await qishuiPost(QISHUI_FEED_SONG_TAB_PATH, {
            count: limit,
            played_media: [],
            common_params: {
              trigger_name: "mineradio_feed",
              scene: "feed",
              source: "mineradio"
            }
          });
          const rawItems = extractQishuiMediaList(json);
          const songs = rawItems.map((item, index) => mapQishuiMedia(item, index, "feed")).filter(Boolean).slice(0, limit);
          return { provider: "qishui", configured: true, songs, rawCount: rawItems.length };
        });
      }
      async function handleQishuiFeed(limit, cookieText) {
        return fetchQishuiFeedSongs(Math.max(1, Math.min(18, Number(limit) || 8)), cookieText);
      }
      function buildQishuiFeedPlaylist(songs) {
        songs = Array.isArray(songs) ? songs : [];
        const firstCover = songs.map((song) => song && song.cover).find(Boolean) || "";
        return {
          provider: "qishui",
          source: "qishui",
          type: "playlist",
          id: QISHUI_VIRTUAL_FEED_PLAYLIST_ID,
          name: "汽水推荐",
          cover: firstCover,
          trackCount: songs.length,
          playCount: 0,
          creator: "汽水音乐",
          subscribed: false,
          virtual: true,
          playbackMode: "recommend-match"
        };
      }
      async function handleQishuiUserPlaylists(cookieText) {
        const status = getQishuiStatus(cookieText);
        if (status.webSession) {
          try {
            const library = await fetchQishuiWebLibrary(cookieText);
            const feed = await fetchQishuiFeedSongs(24, cookieText).catch(() => ({ songs: [], rawCount: 0 }));
            const likedTracks = library.likedTracks || [];
            const likedCard = library.likedCard || {};
            const profile = library.profile || {};
            const recentTracks = library.recentTracks || [];
            const playlists = [
              buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, "汽水我的喜欢", likedTracks, {
                subscribed: false,
                shelfPane: "mine",
                owned: true,
                webSession: true,
                cover: likedCard.cover,
                trackCount: likedTracks.length || likedCard.trackCount || 0,
                creator: profile.nickname || likedCard.creator
              })
            ];
            (library.playlists || []).forEach((pl) => {
              if (!pl || !pl.id || playlists.some((item) => item.id === pl.id)) return;
              playlists.push(pl);
            });
            if (recentTracks.length) {
              playlists.push(buildQishuiVirtualPlaylist(QISHUI_WEB_RECENT_PLAYLIST_ID, "汽水最近播放", recentTracks, {
                subscribed: false,
                shelfPane: "mine",
                owned: true,
                webSession: true
              }));
            }
            playlists.push(buildQishuiFeedPlaylist(feed && feed.songs || []));
            return {
              provider: "qishui",
              loggedIn: true,
              configured: true,
              webSession: true,
              playlists,
              tracksPreview: likedTracks.slice(0, 8),
              rawCount: feed && feed.rawCount || 0,
              libraryErrors: library.errors || [],
              profile,
              userId: profile.userId || "",
              nickname: profile.nickname || "",
              avatar: profile.avatar || ""
            };
          } catch (err) {
            return {
              provider: "qishui",
              loggedIn: true,
              configured: true,
              webSession: true,
              playlists: [
                buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, "汽水我的喜欢", [], { subscribed: false, shelfPane: "mine", owned: true, webSession: true }),
                buildQishuiFeedPlaylist([])
              ],
              error: err && err.message || "QISHUI_WEB_LIBRARY_FAILED",
              message: "汽水账号已登录，但歌单同步暂时失败，请稍后重试。"
            };
          }
        }
        if (!status.configured) {
          return {
            provider: "qishui",
            loggedIn: false,
            configured: false,
            playlists: [],
            error: "QISHUI_TOKEN_REQUIRED",
            message: status.message
          };
        }
        try {
          const feed = await fetchQishuiFeedSongs(24, cookieText);
          const playlist = buildQishuiFeedPlaylist(feed.songs || []);
          return {
            provider: "qishui",
            loggedIn: true,
            configured: true,
            playlists: [playlist],
            tracksPreview: (feed.songs || []).slice(0, 8),
            rawCount: feed.rawCount || 0
          };
        } catch (err) {
          return {
            provider: "qishui",
            loggedIn: true,
            configured: true,
            playlists: [],
            error: err && err.message || "QISHUI_FEED_FAILED",
            message: "汽水推荐歌单暂时同步失败，请稍后重试。"
          };
        }
      }
      async function handleQishuiPlaylistTracks(playlistId, opts, cookieText) {
        opts = opts || {};
        const status = getQishuiStatus(cookieText);
        const id = normalizeText(String(playlistId || "").replace(/^qishui:/i, ""));
        const limit = Math.max(1, Math.min(50, Number(opts.limit) || 50));
        const offset = Math.max(0, Number(opts.offset) || 0);
        if (status.webSession) {
          if (id === QISHUI_WEB_LIKED_PLAYLIST_ID || id === "liked" || id === "favorite") {
            const library = await fetchQishuiWebLibrary(cookieText);
            let allSongs2 = library.likedTracks || [];
            if (!allSongs2.length && library.likedCard && library.likedCard.id) {
              const detail = await fetchQishuiWebPlaylistTracks(library.likedCard.id, cookieText, opts).catch(() => null);
              if (detail && detail.tracks) {
                const playlist3 = buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, "汽水我的喜欢", detail.tracks, {
                  subscribed: false,
                  shelfPane: "mine",
                  owned: true,
                  webSession: true,
                  cover: library.likedCard.cover || detail.playlist && detail.playlist.cover,
                  trackCount: detail.total || library.likedCard.trackCount || detail.tracks.length,
                  creator: library.profile && library.profile.nickname
                });
                return {
                  provider: "qishui",
                  loggedIn: true,
                  configured: true,
                  webSession: true,
                  playlist: playlist3,
                  tracks: detail.tracks,
                  total: detail.total || detail.tracks.length,
                  offset,
                  limit,
                  nextOffset: detail.nextOffset,
                  hasMore: !!detail.hasMore
                };
              }
            }
            const tracks2 = allSongs2.slice(offset, offset + limit);
            const playlist2 = buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, "汽水我的喜欢", allSongs2, {
              subscribed: false,
              shelfPane: "mine",
              owned: true,
              webSession: true,
              cover: library.likedCard && library.likedCard.cover,
              trackCount: allSongs2.length || library.likedCard && library.likedCard.trackCount || 0,
              creator: library.profile && library.profile.nickname
            });
            return {
              provider: "qishui",
              loggedIn: true,
              configured: true,
              webSession: true,
              playlist: playlist2,
              tracks: tracks2,
              total: allSongs2.length,
              offset,
              limit,
              nextOffset: offset + tracks2.length,
              hasMore: offset + tracks2.length < allSongs2.length
            };
          }
          if (id === QISHUI_WEB_RECENT_PLAYLIST_ID || id === "recent") {
            const library = await fetchQishuiWebLibrary(cookieText);
            const allSongs2 = library.recentTracks || [];
            const tracks2 = allSongs2.slice(offset, offset + limit);
            const playlist2 = buildQishuiVirtualPlaylist(QISHUI_WEB_RECENT_PLAYLIST_ID, "汽水最近播放", allSongs2, {
              subscribed: false,
              shelfPane: "mine",
              owned: true,
              webSession: true
            });
            return {
              provider: "qishui",
              loggedIn: true,
              configured: true,
              webSession: true,
              playlist: playlist2,
              tracks: tracks2,
              total: allSongs2.length,
              offset,
              limit,
              nextOffset: offset + tracks2.length,
              hasMore: offset + tracks2.length < allSongs2.length
            };
          }
          if (id && id !== QISHUI_VIRTUAL_FEED_PLAYLIST_ID && id !== "feed") {
            return fetchQishuiWebPlaylistTracks(id, cookieText, opts);
          }
        }
        if (!status.configured) {
          return {
            provider: "qishui",
            loggedIn: false,
            configured: false,
            playlist: buildQishuiFeedPlaylist([]),
            tracks: [],
            total: 0,
            error: "QISHUI_TOKEN_REQUIRED",
            message: status.message
          };
        }
        if (id && id !== QISHUI_VIRTUAL_FEED_PLAYLIST_ID && id !== "feed") {
          return {
            provider: "qishui",
            loggedIn: true,
            configured: true,
            playlist: buildQishuiFeedPlaylist([]),
            tracks: [],
            total: 0,
            error: "QISHUI_PLAYLIST_NOT_FOUND",
            message: "当前汽水接入只支持官方推荐歌单。"
          };
        }
        const fetchCount = Math.max(limit, Math.min(50, offset + limit));
        const feed = await fetchQishuiFeedSongs(fetchCount, cookieText);
        const allSongs = feed.songs || [];
        const tracks = allSongs.slice(offset, offset + limit);
        const playlist = buildQishuiFeedPlaylist(allSongs);
        return {
          provider: "qishui",
          loggedIn: true,
          configured: true,
          playlist,
          tracks,
          total: allSongs.length,
          offset,
          limit,
          nextOffset: offset + tracks.length,
          hasMore: false,
          rawCount: feed.rawCount || allSongs.length
        };
      }
      function qishuiCollectionIds(value) {
        const values = Array.isArray(value) ? value : String(value == null ? "" : value).split(",");
        const seen = /* @__PURE__ */ new Set();
        const ids = [];
        values.forEach((item) => {
          const id = normalizeText(item && typeof item === "object" ? item.id || item.trackId || item.track_id || item.providerSongId : item);
          if (!id || seen.has(id)) return;
          seen.add(id);
          ids.push(id);
        });
        return ids;
      }
      function qishuiWriteEnabled(value) {
        if (value === false || value === 0) return false;
        return !/^(?:false|0|off|no)$/i.test(normalizeText(value));
      }
      async function handleQishuiCheckTracksLiked(trackIds, cookieText) {
        const ids = qishuiCollectionIds(trackIds);
        if (!ids.length) return { provider: "qishui", loggedIn: qishuiCookieHasLogin(cookieText), ids: [], liked: {}, complete: true };
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) {
          return { provider: "qishui", loggedIn: false, ids, liked: {}, complete: false, error: "QISHUI_COOKIE_REQUIRED" };
        }
        const library = await fetchQishuiWebLibrary(cookie);
        let knownTracks = dedupeQishuiSongs(library.likedTracks || []);
        let complete = false;
        if (library.likedCard && library.likedCard.id) {
          const detail = await fetchQishuiWebPlaylistTracks(library.likedCard.id, cookie, { limit: 50, offset: 0 }).catch(() => null);
          if (detail && Array.isArray(detail.tracks)) {
            knownTracks = dedupeQishuiSongs(knownTracks.concat(detail.tracks));
            complete = !detail.hasMore;
          } else {
            complete = false;
          }
        }
        const knownLiked = new Set(knownTracks.map((song) => String(song.providerSongId || song.id || "")).filter(Boolean));
        const liked = {};
        ids.forEach((id) => {
          liked[id] = knownLiked.has(id);
        });
        return {
          provider: "qishui",
          loggedIn: true,
          ids,
          liked,
          complete,
          checkedCount: knownLiked.size
        };
      }
      async function handleQishuiSetTrackLiked(trackId, liked, cookieText) {
        const id = normalizeText(trackId);
        if (!id) throw new Error("Missing Qishui track id");
        liked = qishuiWriteEnabled(liked);
        const apiPath = liked ? "/luna/pc/me/collection/media" : "/luna/pc/me/collection/media/delete";
        await qishuiPcPostJson(apiPath, {
          media: [{ type: "track", id }],
          scene: ""
        }, cookieText, { errorCode: liked ? "QISHUI_LIKE_FAILED" : "QISHUI_UNLIKE_FAILED" });
        invalidateQishuiLibraryCaches();
        return { provider: "qishui", loggedIn: true, id, liked, ok: true };
      }
      async function handleQishuiSetPlaylistCollected(playlistId, collected, cookieText) {
        const id = normalizeText(String(playlistId || "").replace(/^qishui:/i, ""));
        if (!id) throw new Error("Missing Qishui playlist id");
        collected = qishuiWriteEnabled(collected);
        await qishuiPcPostJson(
          collected ? "/luna/pc/me/collection/playlist" : "/luna/pc/me/collection/playlist/delete",
          { playlist_ids: [id] },
          cookieText,
          { errorCode: collected ? "QISHUI_PLAYLIST_COLLECT_FAILED" : "QISHUI_PLAYLIST_UNCOLLECT_FAILED" }
        );
        invalidateQishuiLibraryCaches();
        return { provider: "qishui", loggedIn: true, id, collected, ok: true };
      }
      async function handleQishuiPlaylistAddSong(playlistId, track, cookieText) {
        const playlistIdValue = normalizeText(String(playlistId || "").replace(/^qishui:/i, ""));
        const trackId = normalizeText(track && typeof track === "object" ? track.providerSongId || track.trackId || track.track_id || track.id : track);
        if (!playlistIdValue || !trackId) throw new Error("Missing Qishui playlist or track id");
        await qishuiPcPostJson("/luna/pc/me/playlist/media/append", {
          playlist_id: playlistIdValue,
          media: [{ id: trackId, type: "track" }]
        }, cookieText, { errorCode: "QISHUI_PLAYLIST_ADD_FAILED" });
        invalidateQishuiLibraryCaches();
        return {
          provider: "qishui",
          loggedIn: true,
          pid: playlistIdValue,
          id: trackId,
          success: true,
          ok: true
        };
      }
      async function handleQishuiSetAlbumCollected(albumId, collected, cookieText) {
        const id = normalizeText(albumId);
        if (!id) throw new Error("Missing Qishui album id");
        collected = qishuiWriteEnabled(collected);
        await qishuiPcPostJson(
          collected ? "/luna/pc/me/collection/album" : "/luna/pc/me/collection/album/delete",
          { album_ids: [id] },
          cookieText,
          { errorCode: collected ? "QISHUI_ALBUM_COLLECT_FAILED" : "QISHUI_ALBUM_UNCOLLECT_FAILED" }
        );
        invalidateQishuiLibraryCaches();
        return { provider: "qishui", loggedIn: true, id, collected, ok: true };
      }
      async function handleQishuiReportRecentlyPlayed(trackId, cookieText) {
        const id = normalizeText(trackId);
        if (!id) throw new Error("Missing Qishui track id");
        await qishuiPcPostJson("/luna/pc/me/recently-played-media", {
          media: [{ type: "track", id }]
        }, cookieText, { errorCode: "QISHUI_RECENT_PLAY_REPORT_FAILED", timeoutMs: 6500 });
        qishuiWebLibraryCache.clear();
        return { provider: "qishui", loggedIn: true, id, reported: true, ok: true };
      }
      function extractQishuiCommentList(payload) {
        const data = payload && payload.data || payload || {};
        return pickArray(
          data.comments,
          data.comment_list,
          data.commentList,
          data.items,
          data.list,
          payload && payload.comments
        );
      }
      function mapQishuiComment(raw) {
        raw = raw && typeof raw === "object" ? raw : {};
        const comment = pickObject(raw.comment, raw.comment_info, raw.commentInfo, raw);
        const user = pickObject(
          comment.user,
          comment.user_info,
          comment.userInfo,
          comment.author,
          raw.user,
          raw.user_info,
          raw.author
        );
        const timeRaw = Number(
          comment.create_time || comment.createTime || comment.created_at || comment.createdAt || comment.time || raw.create_time || raw.time || 0
        ) || 0;
        return {
          id: normalizeText(comment.id || comment.comment_id || comment.commentId || raw.id || ""),
          content: normalizeLyricBody(comment.text || comment.content || comment.comment_text || comment.commentText || ""),
          likedCount: Number(comment.like_count || comment.likeCount || comment.digg_count || comment.diggCount || comment.liked_count || 0) || 0,
          time: timeRaw && timeRaw < 1e10 ? timeRaw * 1e3 : timeRaw,
          user: {
            id: normalizeText(user.id || user.user_id || user.userId || user.uid || ""),
            nickname: normalizeText(user.nickname || user.nick_name || user.nickName || user.name || ""),
            avatar: qishuiFirstImageUrl(
              "~c5_100x100.jpg",
              user.avatar_url,
              user.avatarUrl,
              user.avatar,
              user.medium_avatar_url,
              user.larger_avatar_url
            )
          }
        };
      }
      async function handleQishuiComments(trackId, opts, cookieText) {
        const id = normalizeText(trackId);
        if (!id) return { provider: "qishui", id: "", comments: [], total: 0, error: "Missing Qishui track id" };
        const cookie = normalizeQishuiCookieInput(cookieText);
        if (!qishuiCookieHasLogin(cookie)) {
          return { provider: "qishui", id, loggedIn: false, comments: [], total: 0, error: "QISHUI_COOKIE_REQUIRED" };
        }
        opts = opts || {};
        const count = Math.max(1, Math.min(30, Number(opts.count || opts.limit) || 20));
        const cursor = normalizeText(opts.cursor != null ? opts.cursor : opts.offset || "");
        const json = await qishuiWebRequestJson("/luna/pc/comments", qishuiPcAppParams({
          group_id: id,
          cursor,
          count,
          group_type: 0
        }), cookie, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          timeoutMs: 8500
        });
        const rawComments = extractQishuiCommentList(json);
        const comments = rawComments.map(mapQishuiComment).filter((comment) => comment.content);
        const data = json && json.data || json || {};
        const nextCursor = normalizeText(data.next_cursor || data.nextCursor || data.cursor || json && (json.next_cursor || json.cursor) || "");
        const total = Number(data.total || data.total_count || data.totalCount || data.count || json && (json.total || json.count) || comments.length) || comments.length;
        return {
          provider: "qishui",
          id,
          loggedIn: true,
          comments,
          total,
          cursor,
          nextCursor,
          hasMore: !!(data.has_more || data.hasMore || nextCursor)
        };
      }
      async function handleQishuiCreateComment(trackId, text, cookieText) {
        const id = normalizeText(trackId);
        text = normalizeLyricBody(text);
        if (!id) throw new Error("Missing Qishui track id");
        if (!text) throw new Error("Missing Qishui comment text");
        const json = await qishuiPcPostJson("/luna/pc/comments/create", {
          group_id: id,
          text,
          group_type: 0
        }, cookieText, { errorCode: "QISHUI_COMMENT_CREATE_FAILED" });
        const rawComments = extractQishuiCommentList(json);
        const comment = rawComments.length ? mapQishuiComment(rawComments[0]) : mapQishuiComment(json && json.data || json);
        return {
          provider: "qishui",
          id,
          loggedIn: true,
          created: true,
          ok: true,
          comment: comment.content ? comment : null
        };
      }
      function qishuiLyricTextFromNode(value) {
        value = qishuiMaybeParseJson(value);
        if (typeof value === "string") {
          const text = normalizeLyricBody(value);
          return /^https?:\/\//i.test(text) ? "" : text;
        }
        if (!value || typeof value !== "object") return "";
        const entity = pickObject(
          value.lyric_entity,
          value.lyricEntity,
          value.original_lyric,
          value.originalLyric,
          value
        );
        for (const key of ["content", "lyric_text", "lyricText", "text", "original_content", "originalContent"]) {
          const text = qishuiLyricTextFromNode(entity[key]);
          if (text) return text;
        }
        if (entity !== value) return qishuiLyricTextFromNode(entity);
        return "";
      }
      function extractQishuiLyrics(payload) {
        const found = { lyric: "", tlyric: "" };
        const seen = /* @__PURE__ */ new Set();
        let visitedNodes = 0;
        function visit(node, pathText, depth) {
          if (!node || depth > 7 || visitedNodes >= 600 || found.lyric && found.tlyric) return;
          node = qishuiMaybeParseJson(node);
          if (!node || typeof node !== "object") return;
          if (seen.has(node)) return;
          seen.add(node);
          visitedNodes += 1;
          Object.keys(node).slice(0, 120).forEach((key) => {
            const child = node[key];
            const childPath = pathText ? pathText + "." + key : key;
            if (/lyric|lyrics|tlyric|translation/i.test(key)) {
              const text = qishuiLyricTextFromNode(child);
              if (text) {
                if (/translat|tlyric|lang_translation|translated/i.test(childPath)) {
                  if (!found.tlyric) found.tlyric = text;
                } else if (!found.lyric) {
                  found.lyric = text;
                }
              }
            }
            if (/^(album_tracks|artist_tracks|chart_tracks|comments|prompts|recommend_media_list)$/i.test(key)) return;
            visit(child, childPath, depth + 1);
          });
        }
        visit(payload, "", 0);
        return found;
      }
      async function fetchQishuiSeoTrack(trackId) {
        return requestJson(urlWithParams("https://beta-luna.douyin.com/luna/h5/seo_track", {
          track_id: trackId,
          device_platform: "web"
        }), {
          timeoutMs: 8e3,
          headers: {
            "Accept": "application/json,text/plain,*/*",
            "User-Agent": QISHUI_WEB_UA,
            "Referer": "https://www.douyin.com/"
          }
        });
      }
      function qishuiSeoTrackFromPayload(payload) {
        const seo = pickObject(payload && payload.seo_track, payload && payload.seoTrack);
        const data = pickObject(payload && payload.data);
        return pickObject(
          seo.track,
          payload && payload.track,
          data.track,
          data.track_info,
          payload && payload.track_info
        );
      }
      function qishuiSongFromSeoTrack(track, fallbackId) {
        track = track && typeof track === "object" ? track : {};
        const album = pickObject(track.album, track.album_info, track.albumInfo);
        const id = normalizeText(track.id || track.track_id || track.trackId || fallbackId);
        const name = normalizeText(track.name || track.title || track.song_name);
        if (!id || !name) return null;
        const artists = pickArray(track.artists, track.artist_list, track.artistList).map((item) => ({
          id: normalizeText(item && (item.id || item.artist_id || item.artistId)),
          name: normalizeText(item && (item.name || item.display_name || item.simple_display_name || item.title)),
          mid: normalizeText(item && (item.id || item.artist_id || item.artistId))
        })).filter((item) => item.name);
        const artist = artists.map((item) => item.name).join(" / ") || normalizeText(track.artist || track.artist_name || "");
        const albumId = normalizeText(album.id || album.album_id || album.albumId);
        return {
          provider: "qishui",
          source: "qishui-public-seo",
          type: "qishui",
          id,
          providerSongId: id,
          name,
          artist,
          artists,
          album: normalizeText(album.name || album.title || album.album_name || ""),
          album_id: albumId,
          albumId,
          cover: qishuiFirstImageUrl("~c5_375x375.jpg", album.url_cover, album.cover_url, album.cover, track.url_cover, track.cover_url),
          duration: qishuiNormalizeDurationSeconds(track.duration_ms || track.duration || 0),
          playable: false,
          playbackMode: "recommend-match",
          recommendationSource: "qishui-public-seo",
          lyric: "",
          tlyric: "",
          restriction: qishuiRestriction("provider_limited", "汽水音乐当前作为推荐/匹配源接入，播放时会自动寻找其它可播版本。", "switch_source")
        };
      }
      async function handleQishuiSongDetail(trackId) {
        const id = normalizeText(trackId);
        if (!id) return { provider: "qishui", error: "MISSING_QISHUI_TRACK_ID", song: null };
        try {
          const track = qishuiSeoTrackFromPayload(await fetchQishuiSeoTrack(id));
          const song = qishuiSongFromSeoTrack(track, id);
          if (!song) return { provider: "qishui", error: "QISHUI_TRACK_DETAIL_EMPTY", song: null };
          return { provider: "qishui", song, album: song.album ? {
            provider: "qishui",
            id: song.albumId,
            albumId: song.albumId,
            name: song.album,
            artist: song.artist,
            cover: song.cover,
            type: "album"
          } : null };
        } catch (e) {
          return { provider: "qishui", error: e.message || "QISHUI_TRACK_DETAIL_FAILED", song: null };
        }
      }
      async function handleQishuiLyric(id, cookieText) {
        id = normalizeText(id);
        if (!id) return { provider: "qishui", lyric: "", tlyric: "", source: "none", error: "Missing Qishui id" };
        const cached = qishuiLyricCache.get(id);
        if (cached) return cached;
        const errors = [];
        try {
          const seoPayload = await fetchQishuiSeoTrack(id);
          const lyrics = extractQishuiLyrics(seoPayload);
          const cachedSeo = cacheQishuiLyric(id, lyrics.lyric, lyrics.tlyric, "qishui-beta-seo-track");
          if (cachedSeo) return cachedSeo;
        } catch (err) {
          errors.push("seo:" + (err && err.message || String(err)));
        }
        if (qishuiCookieHasLogin(normalizeQishuiCookieInput(cookieText))) {
          try {
            const trackPayload = await fetchQishuiPcTrackV2Get(id, cookieText);
            const lyrics = extractQishuiLyrics(trackPayload);
            const cachedTrack = cacheQishuiLyric(id, lyrics.lyric, lyrics.tlyric, "qishui-pc-track-v2");
            if (cachedTrack) return cachedTrack;
          } catch (err) {
            errors.push("track-v2:" + (err && err.message || String(err)));
          }
        }
        if (QISHUI_PUBLIC_ENABLED) {
          try {
            const detail = await fetchQishuiPublicDetail(id);
            const fresh = qishuiLyricCache.get(id);
            if (fresh) return fresh;
            if (detail && (detail.lyric || detail.tlyric)) {
              const cachedPublic = cacheQishuiLyric(id, detail.lyric, detail.tlyric, "qishui-public-detail");
              if (cachedPublic) return cachedPublic;
            }
          } catch (err) {
            errors.push("public:" + (err && err.message || String(err)));
          }
        }
        return {
          provider: "qishui",
          lyric: "",
          tlyric: "",
          yrc: "",
          ytlrc: "",
          source: "none",
          error: errors.join("; ")
        };
      }
      function qishuiPrimaryTrackFromV2(payload) {
        const data = payload && payload.data || payload || {};
        return pickObject(data.track, data.track_info, data.trackInfo, payload && payload.track, payload && payload.track_info, payload && payload.trackInfo);
      }
      function qishuiTrackPlayerFromV2(payload, track) {
        const data = payload && payload.data || payload || {};
        return pickObject(
          data.track_player,
          data.trackPlayer,
          payload && payload.track_player,
          payload && payload.trackPlayer,
          track && track.track_player,
          track && track.trackPlayer
        );
      }
      function qishuiAudioEffectKeysFromV2(payload, track) {
        const player = qishuiTrackPlayerFromV2(payload, track) || {};
        const raw = player.audio_effects || player.audioEffects || track && (track.audio_effects || track.audioEffects) || {};
        let effects = raw;
        if (typeof effects === "string") effects = qishuiMaybeParseJson(effects);
        if (!effects || typeof effects !== "object" || Array.isArray(effects)) return [];
        return Object.keys(effects).map((key) => normalizeText(key)).filter((key, index, list) => key && key.length <= 64 && list.indexOf(key) === index).slice(0, 32);
      }
      async function fetchQishuiPcTrackV2Post(trackId, cookieText) {
        const body = JSON.stringify({
          track_id: trackId,
          media_type: "track",
          queue_type: "favorite_track_playlist",
          scene_name: "library"
        });
        const json = await qishuiWebRequestJson("/luna/pc/track_v2", qishuiPcAppParams(), cookieText, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          method: "POST",
          body,
          referer: "https://www.qishui.com/",
          timeoutMs: 1e4
        });
        const err = qishuiPcStatusError(json, "QISHUI_PC_TRACK_V2_FAILED");
        if (err) throw err;
        return json;
      }
      async function fetchQishuiPcTrackV2Get(trackId, cookieText) {
        const json = await qishuiWebRequestJson("/luna/pc/track_v2", qishuiPcAppParams({
          track_id: trackId,
          media_type: "track"
        }), cookieText, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          referer: "https://www.qishui.com/",
          timeoutMs: 1e4
        });
        const err = qishuiPcStatusError(json, "QISHUI_PC_TRACK_V2_GET_FAILED");
        if (err) throw err;
        return json;
      }
      async function fetchQishuiPcTrackV2(trackId, cookieText) {
        const cookie = normalizeQishuiCookieInput(cookieText);
        const cacheKey = "track-v2-meta|" + qishuiCookieFingerprint(cookie) + "|" + normalizeText(trackId);
        return qishuiTrackMetadataCache.wrap(cacheKey, 20 * 1e3, async () => {
          try {
            return await fetchQishuiPcTrackV2Post(trackId, cookie);
          } catch (postError) {
            try {
              return await fetchQishuiPcTrackV2Get(trackId, cookie);
            } catch (getError) {
              getError.postError = postError && postError.message || String(postError);
              throw getError;
            }
          }
        });
      }
      function qishuiDiagPlayerInfoStreams(list, context) {
        try {
          const items = (list || []).slice(0, 20).map((item) => {
            if (!item || typeof item !== "object") return null;
            const q = normalizeText(
              qishuiObjectString(item, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType", "gear_des_key", "GearDesKey"]) || ""
            );
            const fmt = normalizeText(qishuiObjectString(item, ["format", "Format", "vtype", "VType", "file_format", "FileFormat"]) || "");
            const br = qishuiNormalizeBitrateKbps(
              qishuiObjectNumber(item, ["bitrate", "Bitrate", "real_bitrate", "RealBitrate", "br", "BR", "bit_rate", "BitRate"]) || 0
            );
            const dur = qishuiNormalizeDurationSeconds(qishuiObjectNumber(item, ["duration", "Duration"]) || 0);
            return { quality: q, format: fmt, bitrate: br, duration: dur, hasUrl: !!qishuiStreamUrlFrom(item) };
          }).filter(Boolean);
          qishuiDiagLog("player_info_streams", Object.assign({
            listLen: list.length,
            items
          }, context || {}));
        } catch (e) {
          qishuiDiagLog("player_info_streams_error", { message: String(e && e.message || e) });
        }
      }
      async function fetchQishuiPlayerInfoStreams(playerInfoUrl, cookieText) {
        playerInfoUrl = normalizeText(playerInfoUrl);
        if (!/^https?:\/\//i.test(playerInfoUrl)) return [];
        const json = await requestJson(playerInfoUrl, {
          timeoutMs: 1e4,
          headers: qishuiHeadersWithCookie({
            "Accept": "application/json,text/plain,*/*",
            "User-Agent": QISHUI_WEB_UA,
            "Referer": "https://api.qishui.com/"
          }, cookieText)
        });
        const result = pickObject(json && json.Result, json && json.result);
        const data = pickObject(result.Data, result.data, json && json.Data, json && json.data);
        const list = pickArray(data.PlayInfoList, data.playInfoList, data.play_info_list, json && json.PlayInfoList);
        qishuiDiagPlayerInfoStreams(list, { source: "fetchQishuiPlayerInfoStreams" });
        const streams = list.map((item) => qishuiStreamFromObject(item)).filter(Boolean);
        if (streams.length) return streams;
        const error = pickObject(json && json.ResponseMetadata && json.ResponseMetadata.Error, json && json.responseMetadata && json.responseMetadata.error);
        if (error && (error.Message || error.message)) throw new Error(normalizeText(error.Message || error.message));
        return [];
      }
      function qishuiDiagTrackV2Shape(payload) {
        try {
          const track = qishuiPrimaryTrackFromV2(payload) || {};
          const player = qishuiTrackPlayerFromV2(payload, track) || {};
          const audioInfo = pickObject(track.audio_info, track.audioInfo, payload && payload.audio_info, payload && payload.audioInfo) || {};
          const playInfoList = pickArray(audioInfo.play_info_list, audioInfo.PlayInfoList, audioInfo.playInfoList) || [];
          const playerPlayInfoList = pickArray(player.play_info_list, player.PlayInfoList, player.playInfoList) || [];
          const bitRates = pickArray(
            track.bit_rates,
            track.bitRates,
            audioInfo.bit_rates,
            audioInfo.bitRates,
            payload && payload.bit_rates,
            payload && payload.bitRates
          ) || [];
          const videoModelRaw = player.video_model || player.VideoModel || player.videoModel || track.video_model || track.VideoModel || payload && payload.video_model || "";
          const labelinfo = pickObject(track.label_info, track.labelinfo, track.labelInfo, payload.label_info, payload.labelinfo, payload.labelInfo) || {};
          const qualitymap = pickObject(labelinfo.qualitymap, labelinfo.qualityMap, labelinfo.quality_map) || {};
          const spatialKeys = [];
          const walkKeys = (node, path2) => {
            if (!node || typeof node !== "object" || path2.length > 6) return;
            if (Array.isArray(node)) {
              node.slice(0, 60).forEach((it, i) => walkKeys(it, path2.concat("[" + i + "]")));
              return;
            }
            for (const k of Object.keys(node).slice(0, 150)) {
              const lk = String(k).toLowerCase();
              if (/spatial|atmos|dolby|immersive/.test(lk)) spatialKeys.push(path2.concat(k).join("."));
              walkKeys(node[k], path2.concat(k));
            }
          };
          walkKeys(payload, []);
          const qualityOf = (it) => qishuiObjectString(it, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType", "gear_des_key", "GearDesKey"]) || "";
          const vm = qishuiMaybeParseJson(videoModelRaw);
          const vmInfo = typeof vm === "string" ? { vmType: "string-unparsed", vmLen: vm.length } : vm && typeof vm === "object" ? { vmType: "object", vmKeys: Object.keys(vm).slice(0, 30) } : { vmType: typeof vm };
          const sanitizeSample = (it) => {
            if (!it || typeof it !== "object") return it;
            const out = {};
            Object.keys(it).slice(0, 40).forEach((k) => {
              const lk = String(k).toLowerCase();
              if (/url|auth|token|cookie|key|secret|signature|spade/i.test(lk)) return;
              const v = it[k];
              if (v && typeof v === "object") {
                out[k] = Object.keys(v).slice(0, 10);
              } else if (typeof v === "string" && v.length > 80) {
                out[k] = v.slice(0, 40) + "...";
              } else {
                out[k] = v;
              }
            });
            return out;
          };
          const bitRateSamples = bitRates.slice(0, 3).map(sanitizeSample);
          const bitRateKeys = bitRates.length ? Object.keys(bitRates[0]).slice(0, 40) : [];
          const hasUrlInBitRates = bitRates.some((it) => !!qishuiStreamUrlFrom(it));
          qishuiDiagLog("track_v2_shape", {
            trackId: String(track.id || track.track_id || payload && payload.track_id || "").slice(0, 24),
            audioInfoKeys: Object.keys(audioInfo),
            playInfoListLen: playInfoList.length,
            playInfoQualities: playInfoList.map(qualityOf).filter(Boolean),
            playerPlayInfoListLen: playerPlayInfoList.length,
            playerPlayInfoQualities: playerPlayInfoList.map(qualityOf).filter(Boolean),
            bitRatesLen: bitRates.length,
            bitRateKeys,
            bitRateQualities: bitRates.map(qualityOf).filter(Boolean),
            bitRateSamples,
            hasUrlInBitRates,
            vmInfo,
            qualitymapKeys: Object.keys(qualitymap),
            trackSpatialKeys: Object.keys(track).filter((k) => /spatial|atmos|dolby/i.test(k)),
            spatialKeysFound: spatialKeys.slice(0, 40)
          });
        } catch (e) {
          qishuiDiagLog("track_v2_shape_error", { message: String(e && e.message || e) });
        }
      }
      function collectQishuiTrackV2Streams(payload) {
        qishuiDiagTrackV2Shape(payload);
        const track = qishuiPrimaryTrackFromV2(payload);
        const player = qishuiTrackPlayerFromV2(payload, track);
        const audioInfo = pickObject(track.audio_info, track.audioInfo, payload && payload.audio_info, payload && payload.audioInfo);
        const playInfoList = pickArray(audioInfo.play_info_list, audioInfo.PlayInfoList, audioInfo.playInfoList);
        const streams = playInfoList.map((item) => qishuiStreamFromObject(item)).filter(Boolean);
        const videoModel = player.video_model || player.VideoModel || player.videoModel || track.video_model || track.VideoModel || "";
        qishuiCollectVideoModelStreams(videoModel, "", {}, streams);
        const bitRates = pickArray(
          track.bit_rates,
          track.bitRates,
          audioInfo.bit_rates,
          audioInfo.bitRates,
          payload && payload.bit_rates,
          payload && payload.bitRates
        );
        const fallbackStreams = bitRates.map((item) => qishuiStreamFromObject(item)).filter(Boolean);
        return { track, player, streams, fallbackStreams };
      }
      async function resolveQishuiDownloadInfo(trackId, payload, cookieText, membership, requestedQuality) {
        const collected = collectQishuiTrackV2Streams(payload);
        const playerInfoUrl = qishuiObjectString(collected.player, ["url_player_info", "URLPlayerInfo", "urlPlayerInfo"]);
        if (playerInfoUrl) {
          try {
            const streams = await fetchQishuiPlayerInfoStreams(playerInfoUrl, cookieText);
            if (streams.length) collected.streams.push(...streams);
          } catch (err) {
            collected.playerInfoError = err && err.message || String(err);
          }
        }
        const needVipMap = qishuiQualityMapNeedVip(payload);
        const allStreams = (collected.streams || []).concat(collected.fallbackStreams || []);
        const requestedTier = requestedQuality ? qishuiNormalizeAppQuality(requestedQuality) : "";
        let best = null;
        if (requestedTier && allStreams.length) {
          const matched = allStreams.filter((s) => qishuiStreamAppTier(s) === requestedTier);
          const allowed = matched.filter((s) => qishuiStreamAllowedWithMap(s, membership, needVipMap));
          if (allowed.length) best = qishuiBestStreamCandidate(allowed);
        }
        if (!best) {
          best = qishuiBestForMembershipMap(collected.streams, membership, needVipMap) || qishuiBestForMembershipMap(collected.fallbackStreams, membership, needVipMap);
        }
        if (!best) {
          const unrestricted = qishuiBestStreamCandidate(collected.streams) || qishuiBestStreamCandidate(collected.fallbackStreams);
          const requiredTier = unrestricted ? qishuiStreamRequiredTier(unrestricted) : "free";
          const entitlementLimited = !!(unrestricted && !qishuiRequiredTierAllowed(requiredTier, membership));
          let errorCode = "QISHUI_AUDIO_SOURCE_EMPTY";
          if (entitlementLimited && !(membership && membership.membershipKnown)) {
            errorCode = "QISHUI_MEMBERSHIP_UNKNOWN";
          } else if (entitlementLimited && requiredTier === "svip") {
            errorCode = "QISHUI_SVIP_REQUIRED";
          } else if (entitlementLimited && requiredTier === "vip") {
            errorCode = "QISHUI_VIP_REQUIRED";
          }
          const err = new Error(errorCode === "QISHUI_AUDIO_SOURCE_EMPTY" ? collected.playerInfoError || errorCode : errorCode);
          err.code = errorCode;
          err.requiredTier = requiredTier;
          throw err;
        }
        const availableQualities = qishuiBuildAvailableQualities(allStreams, needVipMap);
        qishuiDiagLog("resolve_streams", {
          trackId: String(collected.track && (collected.track.id || collected.track.track_id) || "").slice(0, 24),
          requestedTier,
          streamCount: (collected.streams || []).length,
          fallbackCount: (collected.fallbackStreams || []).length,
          allStreamTiers: allStreams.map((s) => ({
            tier: qishuiStreamAppTier(s),
            quality: String(s.quality || "").slice(0, 24),
            format: String(s.format || "").slice(0, 16),
            br: qishuiNormalizeBitrateKbps(s.bitrate),
            hasUrl: !!s.url
          })),
          bestTier: best ? qishuiStreamAppTier(best) : null,
          bestQuality: best ? String(best.quality || "").slice(0, 24) : null,
          bestFormat: best ? String(best.format || "").slice(0, 16) : null,
          bestBr: best ? qishuiNormalizeBitrateKbps(best.bitrate) : 0,
          availableQualities
        });
        return Object.assign(collected, { best, availableQualities });
      }
      function qishuiQualityMapNeedVip(payload) {
        const track = qishuiPrimaryTrackFromV2(payload) || {};
        const labelinfo = pickObject(track.label_info, track.labelinfo, track.labelInfo, payload.label_info, payload.labelinfo, payload.labelInfo) || {};
        const qualitymap = pickObject(labelinfo.qualitymap, labelinfo.qualityMap, labelinfo.quality_map) || {};
        const APP_TO_QS = {
          standard: ["medium", "higher", "standard"],
          exhigh: ["highest", "high", "exhigh"],
          lossless: ["lossless", "sq"],
          hires: ["hires", "hi-res", "hi_res", "highres", "master"],
          atmos: ["spatial", "atmos", "dolby"]
        };
        const VIP_KEYS = ["needvip", "needVip", "need_vip", "vipRequired", "vip_required", "viprequired"];
        const map = {};
        Object.keys(APP_TO_QS).forEach((appTier) => {
          let need = false;
          let known = false;
          APP_TO_QS[appTier].forEach((qsKey) => {
            const entry = qualitymap[qsKey] || qualitymap[String(qsKey).toLowerCase()];
            if (!entry || typeof entry !== "object") return;
            const pd = pickObject(entry.playdetail, entry.play_detail, entry.playDetail, entry.PlayDetail) || {};
            VIP_KEYS.forEach((k) => {
              if (!Object.prototype.hasOwnProperty.call(pd, k)) return;
              known = true;
              const raw = qishuiObjectString(pd, [k]);
              if (raw === "1" || raw === "true" || raw === true) need = true;
              if (qishuiExplicitPositive(pd && pd[k])) need = true;
            });
          });
          if (known) map[appTier] = need;
        });
        return map;
      }
      function qishuiStreamEffRequiredTier(stream, needVipMap) {
        const tier = qishuiStreamAppTier(stream);
        let requiredTier = qishuiStreamRequiredTier(stream);
        if (needVipMap && Object.prototype.hasOwnProperty.call(needVipMap, tier)) {
          requiredTier = qishuiHigherRequiredTier(requiredTier, needVipMap[tier] ? "vip" : "free");
        }
        return requiredTier;
      }
      function qishuiStreamAllowedWithMap(stream, membership, needVipMap) {
        if (!stream || !stream.url) return false;
        return qishuiRequiredTierAllowed(qishuiStreamEffRequiredTier(stream, needVipMap), membership);
      }
      function qishuiBestForMembershipMap(candidates, membership, needVipMap) {
        return qishuiBestStreamCandidate((candidates || []).filter((s) => qishuiStreamAllowedWithMap(s, membership, needVipMap)));
      }
      function qishuiBuildAvailableQualities(streams, needVipMap) {
        const tiers = ["standard", "exhigh", "lossless", "hires", "atmos"];
        const byTier = {};
        (streams || []).forEach((s) => {
          const tier = qishuiStreamAppTier(s);
          if (!tier) return;
          if (!byTier[tier]) byTier[tier] = { key: tier, br: 0, requiredTier: "free" };
          const br = qishuiNormalizeBitrateKbps(s.bitrate);
          if (br > byTier[tier].br) byTier[tier].br = br;
          const streamTier = qishuiStreamEffRequiredTier(s, needVipMap);
          if (QISHUI_TIER_RANK[streamTier] > QISHUI_TIER_RANK[byTier[tier].requiredTier]) {
            byTier[tier].requiredTier = streamTier;
          }
        });
        return tiers.map((t) => {
          const info = byTier[t];
          let requiredTier = needVipMap && needVipMap[t] ? "vip" : "free";
          if (info && QISHUI_TIER_RANK[info.requiredTier] > QISHUI_TIER_RANK[requiredTier]) {
            requiredTier = info.requiredTier;
          }
          return {
            key: t,
            present: !!info,
            requiredTier,
            needvip: requiredTier !== "free",
            br: info ? info.br * 1e3 : 0
          };
        });
      }
      function qishuiUrlWithAuth(url, auth) {
        url = normalizeText(url);
        auth = normalizeText(auth);
        if (!url || !auth || /#auth=/.test(url)) return url;
        return url + "#auth=" + encodeURIComponent(auth);
      }
      async function handleQishuiSongUrl(opts, cookieText) {
        opts = opts && typeof opts === "object" ? opts : { id: opts };
        const id = normalizeText(opts.id || opts.trackId || opts.track_id || "");
        const cookie = normalizeQishuiCookieInput(cookieText || opts.cookie || "");
        if (!id) return qishuiUnavailable("Missing Qishui track id", "missing_id", { loggedIn: qishuiCookieHasLogin(cookie), playbackKeyReady: false });
        if (!qishuiCookieHasLogin(cookie)) {
          return qishuiUnavailable("Qishui playback requires the local SodaMusic PC login state.", "login_required", {
            loggedIn: false,
            playbackKeyReady: false
          });
        }
        const requestedQuality = normalizeText(opts.quality || "");
        let payload;
        try {
          payload = await fetchQishuiPcTrackV2(id, cookie);
        } catch (err) {
          return qishuiUnavailable("Qishui did not return track playback metadata: " + (err && err.message || String(err)), "source_unavailable", {
            loggedIn: true,
            playbackKeyReady: false,
            membershipKnown: false,
            vipType: 0,
            vipLevel: "none",
            isVip: false,
            isSvip: false,
            vipLabel: "无VIP",
            rawError: err && err.message || String(err)
          });
        }
        let membership = qishuiPlaybackMembershipFromPayload(payload);
        if (!membership.membershipKnown) membership = await fetchQishuiPlaybackMembership(cookie);
        const membershipKey = membership.isSvip ? "svip" : membership.isVip ? "vip" : membership.membershipKnown ? "free" : "unknown";
        const cacheKey = "track-v2|" + qishuiCookieFingerprint(cookie) + "|" + membershipKey + "|" + id + "|" + requestedQuality;
        return qishuiPlaybackCache.wrap(cacheKey, 4 * 60 * 1e3, async () => {
          try {
            const resolved = await resolveQishuiDownloadInfo(id, payload, cookie, membership, requestedQuality);
            const track = resolved.track || {};
            const stream = resolved.best;
            const duration = stream.duration || qishuiNormalizeDurationSeconds(track.duration_ms || track.duration || 0);
            const level = qishuiStreamAppTier(stream);
            const fullDuration = qishuiNormalizeDurationSeconds(track.duration_ms || track.duration || 0);
            const availableQualities = resolved.availableQualities || [];
            const audioEffectKeys = qishuiAudioEffectKeysFromV2(payload, track);
            const QISHUI_QUALITY_RANK = { standard: 1, exhigh: 2, lossless: 3, hires: 4, atmos: 5 };
            let qualityCeiling = "";
            availableQualities.forEach((q) => {
              if (q.present && qishuiRequiredTierAllowed(q.requiredTier, membership)) {
                if ((QISHUI_QUALITY_RANK[q.key] || 0) > (QISHUI_QUALITY_RANK[qualityCeiling] || 0)) qualityCeiling = q.key;
              }
            });
            const trial = !!(duration > 0 && fullDuration > 0 && duration + 5 < fullDuration);
            return {
              provider: "qishui",
              playbackMode: "direct-url",
              url: qishuiUrlWithAuth(stream.url, stream.auth),
              playable: true,
              trial,
              loggedIn: true,
              playbackKeyReady: true,
              membershipKnown: !!membership.membershipKnown,
              vipType: membership.vipType || 0,
              vipLevel: membership.vipLevel || "none",
              isVip: !!membership.isVip,
              isSvip: !!membership.isSvip,
              vipLabel: membership.vipLabel || (membership.isVip ? "VIP" : "无VIP"),
              level,
              availableQualities,
              qualityCeiling,
              quality: normalizeText(stream.quality || stream.format || level),
              requiredTier: qishuiStreamRequiredTier(stream),
              audioEffectKeys,
              intelligentAudioEffectAvailable: audioEffectKeys.indexOf("intelligent") >= 0,
              br: qishuiBitrateForUi(stream.bitrate),
              size: Number(stream.size) || 0,
              duration,
              requestedQuality,
              source: "qishui-pc-track-v2",
              encrypted: !!stream.auth
            };
          } catch (err) {
            const entitlementReason = err && err.code === "QISHUI_MEMBERSHIP_UNKNOWN" ? "membership_unknown" : err && err.code === "QISHUI_SVIP_REQUIRED" ? "svip_required" : err && err.code === "QISHUI_VIP_REQUIRED" ? "vip_required" : "";
            const message = entitlementReason === "membership_unknown" ? "汽水音乐暂时无法验证当前账号的会员状态，请稍后重试。" : entitlementReason === "svip_required" ? "汽水音乐仅返回了需要 SVIP 权益的音质。" : entitlementReason === "vip_required" ? "汽水音乐仅返回了需要 VIP 权益的音质。" : "Qishui did not return a playable audio source: " + (err && err.message || String(err));
            return qishuiUnavailable(
              message,
              entitlementReason || "source_unavailable",
              {
                loggedIn: true,
                playbackKeyReady: true,
                requiredTier: err && err.requiredTier || "free",
                membershipKnown: !!membership.membershipKnown,
                vipType: membership.vipType || 0,
                vipLevel: membership.vipLevel || "none",
                isVip: !!membership.isVip,
                isSvip: !!membership.isSvip,
                vipLabel: membership.vipLabel || (membership.isVip ? "VIP" : "无VIP"),
                rawError: err && err.message || String(err)
              }
            );
          }
        });
      }
      async function qishuiAlbumDetailFromSeoTrack(albumId, trackId) {
        const track = qishuiSeoTrackFromPayload(await fetchQishuiSeoTrack(trackId));
        const song = qishuiSongFromSeoTrack(track, trackId);
        if (!song || !song.albumId || albumId && song.albumId !== albumId) return null;
        return {
          provider: "qishui",
          source: "qishui-public-seo",
          partial: true,
          album: {
            provider: "qishui",
            id: song.albumId,
            albumId: song.albumId,
            name: song.album || "未知专辑",
            artist: song.artist,
            cover: song.cover,
            type: "album"
          },
          songs: [song]
        };
      }
      async function handleQishuiAlbumDetail(albumId, cookieText, limit, trackId) {
        const id = normalizeText(albumId);
        const num = Math.max(10, Math.min(120, parseInt(limit || "80", 10) || 80));
        if (!id && !normalizeText(trackId)) return { provider: "qishui", error: "MISSING_ALBUM_ID", album: null, songs: [] };
        let officialError = "";
        try {
          const cookie = normalizeQishuiCookieInput(cookieText);
          if (qishuiCookieHasLogin(cookie) && id) {
            const json = await qishuiWebRequestJson("/luna/pc/album/detail", qishuiPcAppParams({
              id,
              album_id: id,
              albumId: id,
              cursor: 0,
              count: num,
              cnt: num
            }), cookie, {
              bases: [QISHUI_WEB_PC_API_BASE],
              noDefaultParams: true,
              sessionOnly: true,
              pcApp: true,
              referer: "https://www.qishui.com/",
              timeoutMs: 9e3
            });
            const data = json && json.data || json || {};
            const album = pickObject(
              data.album,
              data.info,
              data.album_info,
              data.album_detail,
              json && json.album,
              json && json.album_info
            );
            const rawSongs = extractQishuiMediaList(json);
            const songs = mapQishuiMediaList(rawSongs, "qishui-album", { directPlayable: false }).slice(0, num);
            if (songs.length) {
              return {
                provider: "qishui",
                album: {
                  provider: "qishui",
                  id,
                  albumId: id,
                  name: normalizeText(album.name || album.title || album.album_name || album.albumName || ""),
                  artist: normalizeText(album.artist || album.artist_name || album.artistName || ""),
                  cover: qishuiFirstImageUrl("~c5_375x375.jpg", album.cover_url, album.cover, album.cover_uri, album.url_cover, album.img),
                  type: "album"
                },
                songs
              };
            }
            officialError = "QISHUI_ALBUM_DETAIL_EMPTY";
          } else {
            officialError = "QISHUI_COOKIE_REQUIRED";
          }
        } catch (e) {
          officialError = e.message || "QISHUI_ALBUM_DETAIL_FAILED";
        }
        if (trackId) {
          try {
            const fallback = await qishuiAlbumDetailFromSeoTrack(id, normalizeText(trackId));
            if (fallback) return Object.assign(fallback, { officialError });
          } catch (e) {
            officialError = officialError || e.message || "QISHUI_PUBLIC_DETAIL_FAILED";
          }
        }
        return { provider: "qishui", error: officialError || "QISHUI_ALBUM_DETAIL_FAILED", album: null, songs: [] };
      }
      module.exports = {
        getQishuiStatus,
        handleQishuiStatus,
        normalizeQishuiCookieInput,
        qishuiCookieHasLogin,
        getQishuiOAuthConfig,
        buildQishuiOAuthAuthorizeUrl,
        exchangeQishuiOAuthCode,
        saveQishuiAccessToken,
        clearQishuiAccessToken,
        handleQishuiSearch,
        handleQishuiArtistDetail,
        handleQishuiSongDetail,
        handleQishuiAlbumDetail,
        handleQishuiFeed,
        handleQishuiUserPlaylists,
        handleQishuiPlaylistTracks,
        handleQishuiCheckTracksLiked,
        handleQishuiSetTrackLiked,
        handleQishuiSetPlaylistCollected,
        handleQishuiPlaylistAddSong,
        handleQishuiSetAlbumCollected,
        handleQishuiReportRecentlyPlayed,
        handleQishuiComments,
        handleQishuiCreateComment,
        handleQishuiLyric,
        handleQishuiSongUrl,
        qishuiUnavailable,
        _test: {
          qishuiPublicSearchScore,
          rankQishuiPublicSongs,
          qishuiConvertLyric,
          extractQishuiLyrics,
          collectQishuiTrackV2Streams,
          qishuiMembershipFromData,
          qishuiPlaybackMembershipFromPayload,
          qishuiMembershipCacheTtlMs,
          qishuiUnknownMembership,
          qishuiApplyMembershipObservation,
          qishuiTrackPlaybackRestriction,
          qishuiTrackRequiresVip,
          qishuiStreamRequiredTier,
          qishuiStreamAppTier,
          qishuiQualityMapNeedVip,
          qishuiStreamEffRequiredTier,
          qishuiBuildAvailableQualities,
          qishuiMembershipTier,
          qishuiRequiredTierAllowed,
          qishuiStreamAllowedForMembership,
          qishuiBestStreamCandidateForMembership,
          qishuiAudioEffectKeysFromV2,
          clearQishuiRuntimeCaches
        }
      };
    }
  });

  // src/qishui-auth-android.js
  var qishui_auth_android_exports = {};
  __export(qishui_auth_android_exports, {
    checkQrConnect: () => checkQrConnect,
    clear: () => clear,
    configure: () => configure,
    constants: () => constants,
    getQrCode: () => getQrCode,
    initSignEngine: () => initSignEngine,
    requestOfficial: () => requestOfficial,
    syncNativeCookiesIntoConfig: () => syncNativeCookiesIntoConfig
  });
  function configure(hooks) {
    getConfig = hooks && hooks.getConfig;
    updateConfig = hooks && hooks.updateConfig;
  }
  function randomDigits(length, firstMax = 9) {
    let value = String(randomInt(1, Math.max(2, firstMax + 1)));
    while (value.length < length) value += String(randomInt(0, 10));
    return value;
  }
  function ensureIdentity() {
    if (typeof getConfig !== "function" || typeof updateConfig !== "function") {
      throw new Error("Qishui auth runtime is not configured");
    }
    const config = getConfig();
    const patch = {};
    if (!config.deviceId) patch.deviceId = randomDigits(16, 8);
    if (!config.installId) patch.installId = randomDigits(15, 8);
    if (!config.verifyPortraitId) patch.verifyPortraitId = randomUUID() + ".login";
    if (!config.computerName) patch.computerName = "Folia-Android";
    if (Object.keys(patch).length) updateConfig(patch);
    const current = getConfig();
    return {
      deviceId: String(current.deviceId),
      installId: String(current.installId),
      verifyPortraitId: String(current.verifyPortraitId),
      computerName: String(current.computerName || "Folia-Android")
    };
  }
  function normalizeBizParams(value) {
    if (!value) return {};
    let source = value;
    if (typeof source === "string") {
      try {
        source = JSON.parse(source);
      } catch (_) {
        const parsed = new URLSearchParams(source);
        return Object.fromEntries(parsed.entries());
      }
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("二次验证 biz_params 格式无效");
    }
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      if (item == null) continue;
      result[String(key)] = typeof item === "object" ? JSON.stringify(item) : String(item);
    }
    return result;
  }
  function mergeDecision(envelope) {
    const data = envelope && envelope.data && typeof envelope.data === "object" ? envelope.data : {};
    const decision = { ...envelope || {}, ...data };
    delete decision.data;
    return decision;
  }
  function officialScanUrl(indexUrl, computerName) {
    const source = new URL(String(indexUrl || ""));
    const token = source.searchParams.get("token");
    if (!token) throw new Error("qrcode_index_url 缺少 token");
    const target = new URL("https://bff-pc.qishui.com/light/invoke/scan_login");
    target.searchParams.set("token", token);
    target.searchParams.set("os", "Windows");
    target.searchParams.set("computer_name", computerName || "Folia-Android");
    return target.toString().replace(/\+/g, "%20");
  }
  function parseCookieString(raw) {
    const result = {};
    String(raw || "").split(";").forEach((pair) => {
      const index = pair.indexOf("=");
      if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    });
    return result;
  }
  function buildCookieString(values) {
    return Object.entries(values).filter(([name]) => name).map(([name, value]) => name + "=" + value).join("; ");
  }
  function nativeCookieJar() {
    const host = typeof window !== "undefined" ? window.FoliaQishuiHost : null;
    if (!host || typeof host.getCookie !== "function") return "";
    const chunks = [];
    for (const url of COOKIE_JAR_URLS) {
      try {
        const value = String(host.getCookie(url) || "");
        if (value) chunks.push(value);
      } catch (_) {
      }
    }
    return chunks.join("; ");
  }
  function syncNativeCookiesIntoConfig() {
    if (typeof getConfig !== "function" || typeof updateConfig !== "function") return false;
    const jar = nativeCookieJar();
    if (!jar) return false;
    const current = parseCookieString(getConfig().cookie || "");
    Object.assign(current, parseCookieString(jar));
    updateConfig({ cookie: buildCookieString(current) });
    return true;
  }
  function lastXhrEntry(needle) {
    const log = window.__foliaXhrLog || [];
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i] && needle.test(String(log[i].url || ""))) return log[i];
    }
    return null;
  }
  function readMsToken() {
    try {
      const stored = window.localStorage.getItem("xmst") || window.localStorage.getItem("xmsty") || "";
      return /^[A-Za-z0-9_-]{118}==$/.test(stored) ? stored : "";
    } catch (_) {
      return "";
    }
  }
  function pageRequest(payload) {
    if (typeof window.__qishuiRequest !== "function") {
      return Promise.reject(new Error("签名页面的 __qishuiRequest 未就绪"));
    }
    try {
      return Promise.resolve(window.__qishuiRequest(payload));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  function delay(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  async function initSignEngine() {
    if (!runtime) runtime = new QishuiAuthRuntime();
    return runtime.initialize();
  }
  async function getQrCode() {
    await initSignEngine();
    return runtime.getQrCode();
  }
  async function checkQrConnect(token) {
    await initSignEngine();
    return runtime.checkQrConnect(token);
  }
  async function requestOfficial(method, targetUrl, options) {
    if (!runtime) runtime = new QishuiAuthRuntime();
    return runtime.requestOfficial(method, targetUrl, options || {});
  }
  async function clear() {
    if (runtime) await runtime.clear();
  }
  var import_browser, API_BASE, AID, APP_VERSION, SDK_VERSION, VERIFY_SDK_VERSION, SECURE_SDK_VERSION, BDMS_VERSION, UA, getConfig, updateConfig, runtime, COOKIE_JAR_URLS, QishuiAuthRuntime, constants;
  var init_qishui_auth_android = __esm({
    "src/qishui-auth-android.js"() {
      "use strict";
      init_globals();
      init_crypto();
      import_browser = __toESM(require_browser(), 1);
      API_BASE = "https://api.qishui.com";
      AID = "386088";
      APP_VERSION = "3.5.2";
      SDK_VERSION = "2.4.13";
      VERIFY_SDK_VERSION = "1.0.29";
      SECURE_SDK_VERSION = "3.3.5";
      BDMS_VERSION = "1.0.0.41";
      UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36";
      getConfig = null;
      updateConfig = null;
      runtime = null;
      COOKIE_JAR_URLS = [
        "https://www.qishui.com/",
        "https://qishui.com/",
        "https://passport.qishui.com/"
      ];
      QishuiAuthRuntime = class {
        constructor() {
          this.browserInfo = null;
          this.initializing = null;
        }
        async initialize() {
          if (this.browserInfo && readMsToken()) return true;
          if (this.initializing) return this.initializing;
          this.initializing = this._initialize().finally(() => {
            this.initializing = null;
          });
          return this.initializing;
        }
        async _initialize() {
          ensureIdentity();
          await this.waitForBdms();
          this.browserInfo = await window.__qishuiBrowserInfo();
          if (typeof updateConfig === "function") updateConfig({ msToken: readMsToken() });
          return true;
        }
        async waitForBdms(timeoutMs = 2e4) {
          const deadline = Date.now() + timeoutMs;
          let last = null;
          while (Date.now() < deadline) {
            last = {
              glue: window._sdkGlueVersionMap && window._sdkGlueVersionMap.sdkGlueVersion,
              bdms: window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion,
              loaded: Boolean(window.bdms)
            };
            if (last.loaded && last.bdms) return last;
            await delay(100);
          }
          throw new Error("汽水安全组件初始化超时：bdms 1.0.0.41 未就绪");
        }
        commonParams(identity) {
          const info = this.browserInfo || { encrypted: "" };
          return {
            passport_jssdk_version: SDK_VERSION,
            passport_jssdk_type: "normal",
            is_from_ttaccountsdk: "1",
            aid: AID,
            language: "zh",
            account_sdk_source: "web",
            p_js_v: SDK_VERSION,
            p_js_t: "pro",
            p_zt: SECURE_SDK_VERSION,
            p_ver: VERIFY_SDK_VERSION,
            request_host: "app%3A%2F%2Fresources",
            p_bd: BDMS_VERSION,
            biz_trace_id: randomBytes(4).toString("hex"),
            is_new_login: "1",
            is_from_iesaccountsaas: "1",
            device_id: identity.deviceId,
            install_id: identity.installId,
            did: identity.deviceId,
            iid: identity.installId,
            device_platform: "PC",
            version_code: APP_VERSION,
            account_sdk_source_info: String(info.encrypted),
            msToken: readMsToken()
          };
        }
        requestHeaders(identity, bizTraceId) {
          const traceId = randomBytes(16).toString("hex");
          return {
            Accept: "application/json, text/javascript",
            "User-Agent": UA,
            "x-tt-passport-verify-portrait": identity.verifyPortraitId,
            "x-tt-passport-trace-id": bizTraceId,
            "x-tt-trace-id": "00-" + traceId + "-" + traceId.slice(0, 16) + "-01"
          };
        }
        async request(method, pathname, params, data) {
          await this.initialize();
          const identity = ensureIdentity();
          const query = { ...this.commonParams(identity), ...params || {} };
          const url = new URL(pathname, API_BASE);
          for (const [name, value] of Object.entries(query)) {
            if (value != null) url.searchParams.set(name, String(value));
          }
          const headers = this.requestHeaders(identity, query.biz_trace_id);
          let body = null;
          if (data != null) {
            body = new URLSearchParams();
            for (const [name, value] of Object.entries(data)) {
              if (value != null) body.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
            }
            body = body.toString();
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            headers["x-ss-stub"] = createHash("md5").update(body).digest("hex").toUpperCase();
          }
          const payload = {
            method: String(method || "GET").toUpperCase(),
            url: url.toString(),
            headers,
            body,
            timeout: 3e4
          };
          const response = await pageRequest(payload);
          if (!response || response.status < 200 || response.status >= 400) {
            throw new Error("汽水登录接口 HTTP " + (response && response.status || 0) + ": " + String(response && response.body || "").slice(0, 300));
          }
          let envelope;
          try {
            envelope = JSON.parse(response.body || "{}");
          } catch (_) {
            throw new Error("汽水登录接口返回了无效 JSON");
          }
          const passportEntry = lastXhrEntry(/\/passport\//i);
          const signedQuery = (() => {
            try {
              return new URL(String(passportEntry && passportEntry.url || "")).searchParams;
            } catch (_) {
              return new URLSearchParams();
            }
          })();
          const aBogus = signedQuery.get("a_bogus") || "";
          const signedMsToken = signedQuery.get("msToken") || "";
          if (aBogus.length !== 44 || signedMsToken !== readMsToken()) {
            throw new Error("汽水安全参数注入失败：a_bogus 或 msToken 缺失");
          }
          return envelope;
        }
        // 桌面端把 config.cookie 同步进 authSession；安卓没有独立 cookie 罐，
        // 直接并回 config（qr-login 会持久化），发请求时显式放进 Cookie 头。
        async syncSessionCookies(cookieText) {
          const incoming = parseCookieString(cookieText);
          if (!Object.keys(incoming).length) return;
          const current = parseCookieString(getConfig().cookie || "");
          Object.assign(current, incoming);
          updateConfig({ cookie: buildCookieString(current) });
        }
        async requestOfficial(method, targetUrl, options = {}) {
          await this.initialize();
          const identity = ensureIdentity();
          let url;
          try {
            url = new URL(String(targetUrl));
          } catch (_) {
            const error = new Error("汽水官方请求 URL 无效");
            error.code = "QISHUI_OFFICIAL_URL_INVALID";
            throw error;
          }
          if (!/^https:\/\/(?:api|api5-lq)\.qishui\.com$/i.test(url.origin)) {
            const error = new Error("汽水官方请求目标不受支持");
            error.code = "QISHUI_OFFICIAL_HOST_UNSUPPORTED";
            throw error;
          }
          if (url.searchParams.has("device_id")) url.searchParams.set("device_id", identity.deviceId);
          if (url.searchParams.has("iid")) url.searchParams.set("iid", identity.installId);
          if (url.searchParams.has("did")) url.searchParams.set("did", identity.deviceId);
          if (url.searchParams.has("fp")) url.searchParams.set("fp", identity.deviceId);
          const msToken = readMsToken();
          if (msToken && !url.searchParams.has("msToken")) url.searchParams.set("msToken", msToken);
          await this.syncSessionCookies(options.cookie || "");
          const headers = { ...options.headers || {} };
          ["Cookie", "Host", "Content-Length", "Origin", "Referer", "User-Agent"].forEach((name) => {
            delete headers[name];
            delete headers[name.toLowerCase()];
          });
          const cookie = String((getConfig() || {}).cookie || "").trim();
          if (cookie) headers["Cookie"] = cookie;
          const payload = {
            method: String(method || "GET").toUpperCase(),
            url: url.toString(),
            headers,
            body: options.body == null ? null : String(options.body),
            timeout: Number(options.timeoutMs) || 2e4,
            withCredentials: false
          };
          const response = await pageRequest(payload);
          if (!response || response.status < 200 || response.status >= 400) {
            const error = new Error("汽水官方接口 HTTP " + (response && response.status || 0));
            error.code = "QISHUI_OFFICIAL_HTTP_FAILED";
            error.statusCode = response && response.status || 0;
            throw error;
          }
          if (!String(response.body || "").trim()) {
            const error = new Error("汽水官方接口返回空响应");
            error.code = "QISHUI_OFFICIAL_EMPTY_RESPONSE";
            error.statusCode = response.status;
            throw error;
          }
          const apiEntry = lastXhrEntry(/api\d?-lq?\.qishui\.com|\/luna\//i);
          return {
            ...response,
            requestUrl: String(apiEntry && apiEntry.url || url.toString())
          };
        }
        async getQrCode() {
          await this.initialize();
          const identity = ensureIdentity();
          const envelope = await this.request("GET", "/passport/web/get_qrcode/", {
            next: API_BASE,
            need_logo: "false",
            need_short_url: "false"
          });
          const data = envelope.data || {};
          if (envelope.message !== "success" || Number(data.error_code) !== 0) {
            throw new Error("二维码生成失败：code=" + data.error_code + " " + (data.description || envelope.message || ""));
          }
          const scanUrl = officialScanUrl(data.qrcode_index_url, identity.computerName);
          const qrDataUrl = await import_browser.default.toDataURL(scanUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 360,
            color: { dark: "#000000", light: "#ffffff" }
          });
          envelope.data = { ...data, qrcode: qrDataUrl, scan_url: scanUrl };
          return envelope;
        }
        async secondVerify(decision, identity) {
          if (typeof window.__foliaSetMfaVisible === "function") {
            try {
              window.__foliaSetMfaVisible(true);
            } catch (_) {
            }
          }
          try {
            return await window.__qishuiSecondVerify(
              decision,
              { generalParams: {
                device_id: identity.deviceId,
                install_id: identity.installId,
                did: identity.deviceId,
                iid: identity.installId,
                device_platform: "PC",
                version_code: APP_VERSION
              } }
            );
          } finally {
            if (typeof window.__foliaSetMfaVisible === "function") {
              try {
                window.__foliaSetMfaVisible(false);
              } catch (_) {
              }
            }
          }
        }
        async checkQrConnect(token) {
          await this.initialize();
          const identity = ensureIdentity();
          const body = {
            need_logo: "false",
            need_short_url: "false",
            is_frontier: "true",
            token: String(token || ""),
            is_new_login: "1",
            next: API_BASE
          };
          let envelope = await this.request("POST", "/passport/web/check_qrconnect/", {}, body);
          let data = envelope.data || {};
          if (Number(data.error_code) === 2046) {
            const decision = mergeDecision(envelope);
            if (!decision.verify_portrait_id) decision.verify_portrait_id = identity.verifyPortraitId;
            const bizParams = normalizeBizParams(decision.biz_params);
            const verified = await this.secondVerify(decision, identity);
            if (!verified || verified.status !== true) {
              const error = new Error(verified && verified.message || "二次验证未完成");
              error.code = "QISHUI_MFA_CANCELLED";
              throw error;
            }
            envelope = await this.request(
              "POST",
              "/passport/web/check_qrconnect/",
              { isResend: "true" },
              { ...body, ...bizParams }
            );
            data = envelope.data || {};
            if (Number(data.error_code) === 2046) {
              throw new Error("二次验证已通过，但服务端仍返回 2046；请重新刷新二维码");
            }
          }
          const rawStatus = String(data.status || "").trim().toLowerCase();
          if (rawStatus === "3" || rawStatus === "confirmed" || data.session_cookie) {
            await this.persistSessionCookies(data.session_cookie || "");
            const current = parseCookieString(getConfig().cookie || "");
            let touched = false;
            for (const key of ["sessionid", "sessionid_ss", "sid_tt", "sid_guard"]) {
              const value = data[key] || envelope[key];
              if (typeof value === "string" && value) {
                current[key] = value;
                touched = true;
              }
            }
            if (touched) updateConfig({ cookie: buildCookieString(current) });
            await this.harvestRedirectCookies(String(data.redirect_url || data.redirect || ""));
            syncNativeCookiesIntoConfig();
          }
          return envelope;
        }
        /** 原样 GET 一次确认后给的跳转地址，只为让宿主把 Set-Cookie 收进罐子。 */
        async harvestRedirectCookies(redirectUrl) {
          if (!redirectUrl || !/^https?:\/\//i.test(redirectUrl)) return false;
          const identity = ensureIdentity();
          try {
            await pageRequest({
              method: "GET",
              url: redirectUrl,
              headers: this.requestHeaders(identity, ""),
              body: null,
              timeout: 15e3
            });
          } catch (_) {
            return false;
          }
          return true;
        }
        async persistSessionCookies(sessionCookie) {
          const current = parseCookieString(getConfig().cookie || "");
          Object.assign(current, parseCookieString(sessionCookie));
          Object.assign(current, parseCookieString(nativeCookieJar()));
          updateConfig({ cookie: buildCookieString(current), msToken: readMsToken() });
        }
        async clear() {
          if (typeof updateConfig === "function") {
            updateConfig({ cookie: "", msToken: readMsToken() });
          }
        }
      };
      constants = { API_BASE, AID, APP_VERSION };
    }
  });

  // src/generated/qishui-qr-login.cjs
  var require_qishui_qr_login2 = __commonJS({
    "src/generated/qishui-qr-login.cjs"(exports, module) {
      "use strict";
      init_globals();
      var fs = (init_fs(), __toCommonJS(fs_exports));
      var os = (init_os(), __toCommonJS(os_exports));
      var path = (init_path(), __toCommonJS(path_exports));
      var qishuiAuthV6 = (init_qishui_auth_android(), __toCommonJS(qishui_auth_android_exports));
      var DEFAULT_CONFIG_FILE = __foliaProcessEnv.QISHUI_QR_CONFIG_FILE || path.join(__foliaDirname, ".qishui-qr-login.json");
      function defaultConfig() {
        return {
          deviceId: "",
          installId: "",
          verifyPortraitId: "",
          computerName: os.hostname() || "Windows-PC",
          cookie: "",
          msToken: ""
        };
      }
      function readConfig(file) {
        try {
          if (!file || !fs.existsSync(file)) return defaultConfig();
          const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
          return { ...defaultConfig(), ...parsed && typeof parsed === "object" ? parsed : {} };
        } catch (error) {
          console.warn("[QishuiQrLogin] ignored invalid config:", error && error.message || error);
          return defaultConfig();
        }
      }
      function writeConfig(file, value) {
        if (!file) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
      }
      function hasLoginCookie(cookie) {
        return /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt)=/i.test(String(cookie || ""));
      }
      function createQishuiQrLoginBridge(options) {
        options = options && typeof options === "object" ? options : {};
        const auth = options.auth || qishuiAuthV6;
        const configFile = options.configFile || __foliaProcessEnv.QISHUI_QR_CONFIG_FILE || DEFAULT_CONFIG_FILE;
        let config = {
          ...readConfig(configFile),
          ...options.initialConfig && typeof options.initialConfig === "object" ? options.initialConfig : {}
        };
        function getConfig2() {
          return { ...config };
        }
        function updateConfig2(partial) {
          partial = partial && typeof partial === "object" ? partial : {};
          config = { ...config, ...partial };
          writeConfig(configFile, config);
          return getConfig2();
        }
        auth.configure({ getConfig: getConfig2, updateConfig: updateConfig2 });
        async function createQrCode() {
          const result = await auth.getQrCode();
          const data = result && result.data || {};
          if (!data.token || !data.qrcode) {
            const error = new Error("QISHUI_QR_PAYLOAD_INCOMPLETE");
            error.code = "QISHUI_QR_PAYLOAD_INCOMPLETE";
            throw error;
          }
          return result;
        }
        async function checkQrConnect2(token) {
          token = String(token || "").trim();
          if (!token) {
            const error = new Error("QISHUI_QR_TOKEN_REQUIRED");
            error.code = "QISHUI_QR_TOKEN_REQUIRED";
            throw error;
          }
          return auth.checkQrConnect(token);
        }
        async function requestOfficial2(method, targetUrl, options2) {
          if (!auth || typeof auth.requestOfficial !== "function") {
            const error = new Error("汽水官方签名运行时不可用");
            error.code = "QISHUI_AUTH_RUNTIME_UNAVAILABLE";
            throw error;
          }
          return auth.requestOfficial(method, targetUrl, {
            ...options2 && typeof options2 === "object" ? options2 : {},
            cookie: getCookie()
          });
        }
        function getCookie() {
          return String(config.cookie || "").trim();
        }
        function getStatus() {
          const cookie = getCookie();
          return {
            provider: "qishui",
            loggedIn: hasLoginCookie(cookie),
            cookieReady: hasLoginCookie(cookie),
            deviceId: String(config.deviceId || ""),
            msTokenReady: !!config.msToken,
            configFile
          };
        }
        async function clear2() {
          await auth.clear();
          updateConfig2({ cookie: "", msToken: "" });
          return getStatus();
        }
        return {
          createQrCode,
          checkQrConnect: checkQrConnect2,
          requestOfficial: requestOfficial2,
          getCookie,
          getStatus,
          clear: clear2,
          _test: { getConfig: getConfig2, updateConfig: updateConfig2, configFile }
        };
      }
      var bridge = createQishuiQrLoginBridge();
      module.exports = Object.assign(bridge, {
        createQishuiQrLoginBridge,
        hasLoginCookie
      });
    }
  });

  // src/entry.js
  init_globals();
  init_fs();
  var import_qishui_api = __toESM(require_qishui_api(), 1);
  var import_qishui_qr_login = __toESM(require_qishui_qr_login2(), 1);
  init_qishui_auth_android();
  var COOKIE_FILE = __foliaProcessEnv.QISHUI_COOKIE_FILE;
  function qishuiErrorCode(value) {
    return String(value == null ? "" : value).trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function qishuiClampInt(value, fallback, min, max) {
    const raw = value === void 0 || value === null || value === "" ? String(fallback) : String(value);
    const parsed = parseInt(raw, 10) || fallback;
    return Math.max(min, Math.min(max, parsed));
  }
  function qishuiBridgeFailure(code, message) {
    const error = new Error(String(message || code || "Qishui request failed"));
    error.qishuiCode = qishuiErrorCode(code) || "qishui-error";
    return error;
  }
  function qishuiResultMessage(result) {
    if (!result || typeof result !== "object") return "";
    const candidates = [result.message, result.restriction && result.restriction.message, result.error];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
  }
  function qishuiFailureFromResult(operation, result) {
    const category = result && (result.reason || result.restriction && result.restriction.category);
    const raw = category || result && (result.error || result.errorCode) || "";
    return {
      ok: false,
      error: {
        code: qishuiErrorCode(raw) || "qishui-error",
        message: qishuiResultMessage(result) || "Qishui " + operation + " failed"
      }
    };
  }
  function qishuiFailureEnvelope(error, operation) {
    const raw = error && (error.qishuiCode || error.code) || "";
    const message = String(error && error.message || "Qishui " + operation + " failed");
    const code = qishuiErrorCode(raw) || (/COOKIE_REQUIRED|login|not logged/i.test(message) ? "login-required" : "qishui-error");
    return { ok: false, error: { code, message } };
  }
  var QISHUI_RESULT_FAILURES = {
    "song.url": (result) => !result || result.playable === false || !result.url,
    "song.detail": (result) => !result || !result.song,
    album: (result) => !result || !result.album,
    lyric: (result) => !!(result && result.error && !result.lyric),
    comments: (result) => !!(result && result.error),
    "track.liked": (result) => !!(result && result.error),
    "track.like": (result) => !!(result && (result.ok === false || result.success === false)),
    "playlist.collect": (result) => !!(result && (result.ok === false || result.success === false)),
    "playlist.addSong": (result) => !!(result && (result.ok === false || result.success === false)),
    "album.collect": (result) => !!(result && (result.ok === false || result.success === false)),
    "report.play": (result) => !!(result && (result.ok === false || result.success === false)),
    "comment.create": (result) => !!(result && (result.ok === false || result.success === false))
  };
  function readQishuiCookie() {
    try {
      return readFileSync(COOKIE_FILE, "utf8");
    } catch (_) {
      return "";
    }
  }
  function saveQishuiCookie(value) {
    const normalized = import_qishui_api.default.normalizeQishuiCookieInput(value) || String(value || "").replace(/\s+/g, " ").trim();
    writeFileSync(COOKIE_FILE, normalized);
    return normalized;
  }
  var STATUS_ENRICH_BUDGET_MS = 15e3;
  async function withBudget(promise, ms) {
    let timer = null;
    const timeout = new Promise((resolve2) => {
      timer = setTimeout(() => resolve2(null), ms);
    });
    try {
      return await Promise.race([Promise.resolve(promise).catch(() => null), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function cookieKeyNames(text) {
    const names = [];
    String(text || "").split(";").forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return;
      const name = pair.slice(0, eq).trim();
      if (name && !names.includes(name)) names.push(name);
    });
    return names.join(",") || "(empty)";
  }
  var QISHUI_LOGIN_COOKIE_KEYS = ["sessionid", "sessionid_ss", "sid_guard", "sid_tt", "uid_tt", "uid_tt_ss"];
  function loginCookieKeys(text) {
    const obj = {};
    String(text || "").split(";").forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return;
      obj[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
    return QISHUI_LOGIN_COOKIE_KEYS.map((name) => name + (obj[name] ? "=y" : "=n")).join(" ");
  }
  function clearHostCookies() {
    const host = typeof window !== "undefined" ? window.FoliaQishuiHost : null;
    if (!host || typeof host.clearCookies !== "function") return false;
    try {
      host.clearCookies();
      return true;
    } catch (_) {
      return false;
    }
  }
  function hostCookieKeys() {
    const host = typeof window !== "undefined" ? window.FoliaQishuiHost : null;
    if (!host || typeof host.getCookie !== "function") return "(no-host)";
    try {
      return cookieKeyNames(host.getCookie("https://www.qishui.com/"));
    } catch (_) {
      return "(host-threw)";
    }
  }
  async function readQishuiStatus(cookie) {
    const base = import_qishui_api.default.getQishuiStatus(cookie);
    const cookieKeys = cookieKeyNames(cookie);
    const loginKeys = loginCookieKeys(cookie);
    if (!base.webSession) return Object.assign({}, base, { cookieKeys, loginKeys });
    const enriched = await withBudget(import_qishui_api.default.handleQishuiStatus(cookie), STATUS_ENRICH_BUDGET_MS);
    if (enriched) return Object.assign({}, enriched, { cookieKeys, loginKeys });
    return Object.assign({}, base, {
      profileReady: false,
      libraryReady: false,
      statusBudgetExceeded: true,
      profileError: "QISHUI_STATUS_BUDGET_EXCEEDED"
    });
  }
  var handlers = {
    status: () => readQishuiStatus(readQishuiCookie()),
    "login.qr": async () => {
      const result = await import_qishui_qr_login.default.createQrCode();
      const data = result && result.data || {};
      return {
        provider: "qishui",
        token: String(data.token || ""),
        qrcode: String(data.qrcode || ""),
        qrcodeIndexUrl: String(data.qrcode_index_url || ""),
        expireTime: Number(data.expire_time || 0),
        message: "请使用汽水音乐 App 扫码并确认登录",
        // 服务端自己下发的扫码文案（data.copywriting）。上游实测写的是「抖音」，
        // 这里原样带出来，诊断里能直接看到该让用什么 App 扫。
        copywriting: String(data.copywriting || ""),
        webName: String(data.web_name || "")
      };
    },
    "login.check": async (params) => {
      const token = String(params && params.token || "").trim();
      if (!token) {
        const keys = Object.keys(params && typeof params === "object" ? params : {}).join(",") || "(empty)";
        throw qishuiBridgeFailure("missing-token", "二维码登录 token 缺失（params keys: " + keys + "）");
      }
      const api = import_qishui_api.default;
      const bridge = import_qishui_qr_login.default;
      let result;
      try {
        result = await bridge.checkQrConnect(token);
      } catch (error) {
        if (error && error.code === "QISHUI_MFA_CANCELLED") {
          throw qishuiBridgeFailure("mfa-cancelled", error.message || "汽水音乐登录已取消");
        }
        throw error;
      }
      const data = result && result.data || {};
      const errorCode = Number(data.error_code || 0);
      syncNativeCookiesIntoConfig();
      if (bridge.getStatus().loggedIn) {
        const cookie = bridge.getCookie();
        if (!api.qishuiCookieHasLogin(cookie)) {
          throw qishuiBridgeFailure("qishui-qr-session-cookie-missing", "二维码登录未返回有效的会话 Cookie");
        }
        saveQishuiCookie(cookie);
        const status2 = await readQishuiStatus(readQishuiCookie());
        return Object.assign({}, status2, {
          provider: "qishui",
          ok: true,
          loggedIn: true,
          webSession: true,
          cookieReady: true,
          status: "confirmed",
          errorCode: 0,
          error_code: 0,
          message: "登录成功",
          cookieKeys: cookieKeyNames(cookie),
          loginKeys: loginCookieKeys(cookie),
          hostCookieKeys: hostCookieKeys()
        });
      }
      const rawStatus = String(data.status || "").trim().toLowerCase();
      let status = "waiting";
      let waitingForCookie = false;
      if (errorCode === 2 || /^(4|5|expired|timeout)$/.test(rawStatus)) status = "expired";
      else if (errorCode === 7) status = "rate_limited";
      else if (/^(2|scanned|scan)$/.test(rawStatus)) status = "scanned";
      else if (/^(3|confirmed|confirm)$/.test(rawStatus)) {
        status = "scanned";
        waitingForCookie = true;
      }
      const sessionKeys = cookieKeyNames(bridge.getCookie());
      const confirmedWithoutCookie = status === "scanned" && waitingForCookie ? "手机已确认，正在等待下发会话 Cookie（config: " + sessionKeys + " / host: " + hostCookieKeys() + "）" : "";
      return {
        provider: "qishui",
        loggedIn: false,
        status,
        errorCode,
        error_code: errorCode,
        retryAfterMs: errorCode === 7 ? 6e4 : 0,
        message: confirmedWithoutCookie || result && result.message || data.description || "",
        cookieKeys: sessionKeys,
        loginKeys: loginCookieKeys(bridge.getCookie()),
        hostCookieKeys: hostCookieKeys()
      };
    },
    "login.logout": async () => {
      const api = import_qishui_api.default;
      await import_qishui_qr_login.default.clear();
      saveQishuiCookie("");
      clearHostCookies();
      const cleared = api.clearQishuiAccessToken();
      const empty = api.getQishuiStatus("");
      return Object.assign({}, cleared, {
        webSession: false,
        cookieReady: false,
        configured: empty.configured,
        loggedIn: empty.loggedIn
      });
    },
    search: (params) => {
      const p = params || {};
      const keywords = String(p.keywords || "");
      const limit = qishuiClampInt(p.limit, 12, 4, 20);
      const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      return import_qishui_api.default.handleQishuiSearch(keywords, limit, readQishuiCookie(), offset);
    },
    artist: (params) => {
      const p = params || {};
      const artistId = String(p.artistId || "");
      const artistName = String(p.artistName || "");
      const limit = qishuiClampInt(p.limit, 36, 10, 50);
      if (!artistId && !artistName) throw qishuiBridgeFailure("missing-artist-id-or-name", "汽水音乐需要艺人 ID 或名称");
      return import_qishui_api.default.handleQishuiArtistDetail({ artistId, artistName, limit }, readQishuiCookie());
    },
    "song.detail": (params) => import_qishui_api.default.handleQishuiSongDetail(String(params && params.id || "")),
    album: (params) => {
      const p = params || {};
      const id = String(p.id || "");
      const trackId = String(p.trackId || "");
      const limit = qishuiClampInt(p.limit, 80, 10, 120);
      if (!id && !trackId) throw qishuiBridgeFailure("missing-album-id", "汽水音乐需要专辑 ID 或曲目 ID");
      return import_qishui_api.default.handleQishuiAlbumDetail(id, readQishuiCookie(), limit, trackId);
    },
    lyric: (params) => import_qishui_api.default.handleQishuiLyric(String(params && params.id || ""), readQishuiCookie()),
    "song.url": async (params) => {
      const p = params || {};
      const result = await import_qishui_api.default.handleQishuiSongUrl({ id: String(p.id || ""), quality: String(p.quality || "") }, readQishuiCookie());
      if (!result || result.playable === false || !result.url) return result;
      const text = String(result.url);
      const hashIndex = text.indexOf("#auth=");
      if (hashIndex < 0) return result;
      let auth = text.slice(hashIndex + 6);
      try {
        auth = decodeURIComponent(auth);
      } catch (_) {
      }
      const cleanUrl = text.slice(0, hashIndex);
      const host = window.FoliaQishuiHost;
      const proxyUrl = host && typeof host.audioProxyUrl === "function" ? String(host.audioProxyUrl(cleanUrl, auth) || "") : "";
      if (!proxyUrl) return result;
      return Object.assign({}, result, {
        url: proxyUrl,
        upstreamUrl: cleanUrl,
        localProxy: true
      });
    },
    feed: (params) => import_qishui_api.default.handleQishuiFeed(qishuiClampInt((params || {}).limit, 8, 4, 12), readQishuiCookie()),
    "user.playlists": () => import_qishui_api.default.handleQishuiUserPlaylists(readQishuiCookie()),
    "playlist.tracks": (params) => {
      const p = params || {};
      const id = String(p.id || "") || "qishui-feed";
      const limit = qishuiClampInt(p.limit, 0, 0, Number.MAX_SAFE_INTEGER);
      const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      return import_qishui_api.default.handleQishuiPlaylistTracks(id, limit || offset ? { limit: limit || 50, offset } : {}, readQishuiCookie());
    },
    "track.liked": (params) => {
      const raw = Array.isArray((params || {}).ids) ? params.ids.join(",") : String((params || {}).ids || "");
      const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
      return import_qishui_api.default.handleQishuiCheckTracksLiked(ids, readQishuiCookie());
    },
    "track.like": async (params) => {
      const p = params || {};
      const liked = String(p.liked != null ? p.liked : "true") !== "false";
      const result = await import_qishui_api.default.handleQishuiSetTrackLiked(String(p.id || ""), liked, readQishuiCookie());
      return Object.assign({ success: true }, result);
    },
    "playlist.collect": async (params) => {
      const p = params || {};
      const collected = String(p.collected != null ? p.collected : "true") !== "false";
      const result = await import_qishui_api.default.handleQishuiSetPlaylistCollected(String(p.id || ""), collected, readQishuiCookie());
      return Object.assign({ success: true }, result);
    },
    "playlist.addSong": (params) => {
      const p = params || {};
      return import_qishui_api.default.handleQishuiPlaylistAddSong(String(p.playlistId || ""), String(p.trackId || ""), readQishuiCookie());
    },
    "album.collect": async (params) => {
      const p = params || {};
      const collected = String(p.collected != null ? p.collected : "true") !== "false";
      const result = await import_qishui_api.default.handleQishuiSetAlbumCollected(String(p.id || ""), collected, readQishuiCookie());
      return Object.assign({ success: true }, result);
    },
    "report.play": (params) => import_qishui_api.default.handleQishuiReportRecentlyPlayed(String((params || {}).trackId || ""), readQishuiCookie()),
    comments: (params) => {
      const p = params || {};
      const limit = qishuiClampInt(p.limit, 18, 1, 50);
      const sort = String(p.sort || "") || "latest";
      return import_qishui_api.default.handleQishuiComments(String(p.id || ""), { limit, cursor: "", sort }, readQishuiCookie());
    },
    "comment.create": (params) => {
      const p = params || {};
      return import_qishui_api.default.handleQishuiCreateComment(String(p.id || ""), String(p.content || ""), readQishuiCookie());
    }
  };
  function normalizeParams(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (_) {
        return {};
      }
    }
    return {};
  }
  async function request2(operation, params) {
    const name = String(operation || "");
    if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
      return { ok: false, error: { code: "unsupported", message: "Unsupported qishui operation: " + name } };
    }
    try {
      const data = await handlers[name](params && typeof params === "object" ? params : {});
      const failed = QISHUI_RESULT_FAILURES[name];
      if (failed && failed(data)) return qishuiFailureFromResult(name, data);
      return { ok: true, data };
    } catch (error) {
      if (window.console && window.console.warn) {
        window.console.warn("[FoliaQishui] " + name + " failed:", error && error.message || error);
      }
      return qishuiFailureEnvelope(error, name);
    }
  }
  window.__foliaQishui = {
    async start(operation, params, ticket) {
      const envelope = await request2(operation, normalizeParams(params));
      const host = window.FoliaQishuiHost;
      if (host && typeof host.resolve === "function") {
        try {
          host.resolve(String(ticket), JSON.stringify(envelope));
        } catch (error) {
          host.resolve(String(ticket), '{"ok":false,"error":{"code":"serialize-failed","message":"' + String(error && error.message || error).replace(/[\\"]/g, " ") + '"}}');
        }
      }
    }
  };
  window.__foliaSetMfaVisible = function(visible) {
    const host = window.FoliaQishuiHost;
    if (host && typeof host.setMfaVisible === "function") {
      try {
        host.setMfaVisible(visible ? "1" : "0");
      } catch (_) {
      }
    }
  };
  (function announceReady() {
    const host = window.FoliaQishuiHost;
    if (host && typeof host.onReady === "function") {
      try {
        host.onReady("");
      } catch (_) {
      }
    }
  })();
})();
