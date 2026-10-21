"use strict";
(() => {
  // src/car/bytes.js
  function utf8Bytes(text3) {
    return new TextEncoder().encode(String(text3));
  }
  function bytesToBase64(bytes) {
    let binary = "";
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const clean = String(value || "").replace(/\s+/g, "");
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  function concatBytes(...parts) {
    const chunks = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part || []));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  function pemFromBytes(label, bytes) {
    const body = bytesToBase64(bytes);
    const lines = body.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----
${lines.join("\n")}
-----END ${label}-----
`;
  }
  function bytesFromPem(pem) {
    const text3 = String(pem || "");
    const body = text3.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
    return base64ToBytes(body);
  }
  function randomDigits19() {
    const bytes = randomBytes(8);
    let value = 0n;
    for (const byte of bytes) value = value << 8n | BigInt(byte);
    return (value % 9000000000000000000n + 1000000000000000000n).toString();
  }
  function randomHex(byteLength) {
    const bytes = randomBytes(byteLength);
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
  }
  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    const cryptoRef = (typeof globalThis !== "undefined" ? globalThis.crypto : null) || (typeof window !== "undefined" ? window.crypto : null);
    if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
      for (let offset = 0; offset < length; offset += 65536) {
        cryptoRef.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)));
      }
      return bytes;
    }
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }

  // src/car/guard.js
  var subtle = () => {
    const cryptoRef = (typeof globalThis !== "undefined" ? globalThis.crypto : null) || (typeof window !== "undefined" ? window.crypto : null);
    if (!cryptoRef || !cryptoRef.subtle) throw new Error("WebCrypto is unavailable in this runtime");
    return cryptoRef.subtle;
  };
  function derLength(length) {
    if (length < 128) return new Uint8Array([length]);
    if (length < 256) return new Uint8Array([129, length]);
    return new Uint8Array([130, length >> 8, length & 255]);
  }
  function der(tag, ...values) {
    const value = concatBytes(...values);
    return concatBytes(new Uint8Array([tag]), derLength(value.length), value);
  }
  function derInteger(bytes) {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let value = bytes.subarray(start);
    if (value[0] & 128) value = concatBytes(new Uint8Array([0]), value);
    return der(2, value);
  }
  function rawSignatureToDer(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.length % 2 !== 0) throw new Error("Raw ECDSA signature has an odd length");
    const half = bytes.length / 2;
    return der(48, derInteger(bytes.subarray(0, half)), derInteger(bytes.subarray(half)));
  }
  var EC_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };
  async function generateKeyPair() {
    return subtle().generateKey(EC_ALGORITHM, true, ["sign"]);
  }
  async function exportPrivateKeyPem(privateKey) {
    return pemFromBytes("PRIVATE KEY", new Uint8Array(await subtle().exportKey("pkcs8", privateKey)));
  }
  async function importPrivateKeyPem(pem) {
    return subtle().importKey("pkcs8", bytesFromPem(pem), EC_ALGORITHM, true, ["sign"]);
  }
  async function signTextDerBase64(privateKey, text3) {
    const raw = new Uint8Array(await subtle().sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      utf8Bytes(text3)
    ));
    return bytesToBase64(rawSignatureToDer(raw));
  }
  var OID_ATTRIBUTE = (id) => der(6, new Uint8Array([85, 4, id]));
  var OID_ECDSA_SHA256 = der(6, new Uint8Array([42, 134, 72, 206, 61, 4, 3, 2]));
  function subjectAttribute(id, value) {
    return der(49, der(48, OID_ATTRIBUTE(id), der(12, utf8Bytes(value))));
  }
  async function createGuard() {
    const { privateKey, publicKey } = await generateKeyPair();
    const spki = new Uint8Array(await subtle().exportKey("spki", publicKey));
    const subject = der(
      48,
      subjectAttribute(3, "bd-ticket-guard"),
      subjectAttribute(11, ""),
      subjectAttribute(10, "")
    );
    const info = der(48, der(2, new Uint8Array([0])), subject, spki, der(160));
    const algorithm = der(48, OID_ECDSA_SHA256);
    const signature = new Uint8Array(await subtle().sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      info
    ));
    const request2 = der(48, info, algorithm, der(3, new Uint8Array([0]), rawSignatureToDer(signature)));
    return {
      privateKey,
      guardKey: await exportPrivateKeyPem(privateKey),
      csr: bytesToBase64(utf8Bytes(pemFromBytes("CERTIFICATE REQUEST", request2)))
    };
  }

  // src/car/protocol.js
  var QISHUI_UA = "LunaOpenSDK/1.0.10";
  var QISHUI_PREFIX = "/api/luna/v1/platform";
  var QISHUI_CLIENT_KEY = "aw4bbxfujo741d09";
  var QISHUI_COMMON = {
    aid: "765213",
    app_id: "765213",
    app_name: "byte_autoservice_lite",
    version_code: "100010",
    version_name: "1.0.10",
    channel: "bydSong",
    sdk_aid: "753999",
    caller_name: "luna_open_sdk",
    sdk_version_code: "100000100",
    sdk_version_name: "0.0.1",
    sdk_channel: "Test",
    vehicle_type: "BYD",
    device_brand: "BYD",
    device_type: "BYD",
    device_platform: "android",
    resolution: "1920x1080",
    os_version: "13",
    ac: "wifi"
  };
  var QISHUI_OPEN_HOST = "https://open.qishui.com";
  var QISHUI_DOUYIN_HOST = "https://open.douyin.com";
  var QISHUI_OPEN_CLIENT_HOST = "https://open-client.douyin.com";
  function qishuiParams(deviceId) {
    const values = new URLSearchParams(Object.entries(QISHUI_COMMON));
    values.set("device_id", String(deviceId));
    values.set("did", String(deviceId));
    values.set("iid", String(deviceId));
    values.set("vehicle_id", `qishui-${deviceId}`);
    values.set("_timestamp", String(Math.floor(Date.now() / 1e3)));
    const nonce = randomBytes(2);
    values.set("_nonce", String(nonce[0] << 8 | nonce[1]));
    return values.toString();
  }
  var QR_COMMON = {
    aid: "1128",
    client_key: QISHUI_CLIENT_KEY,
    state: "",
    next: "",
    jump_type: "native",
    optional_scope_check: "",
    optional_scope_uncheck: "",
    customize_params: '{"source":"pc_auth","not_skip_confirm":"true"}',
    source_from: "native",
    device_platform: "android",
    app_identity: "82a0737a3f8d93d9958c8a7938bbc365",
    signature: "cf9024ea72d9c71813238b13ea107a3d"
  };
  var QISHUI_QR_SCOPE = "user_info,luna.openapi.platform.interaction,luna.openapi.platform.me_tab,luna.commerce.openapi_platform.vip_info";
  function qrParams() {
    return { ...QR_COMMON, scope: QISHUI_QR_SCOPE };
  }
  var GUARD_KEYS = ["ticket", "guardKey", "guardCert", "guardTsSign"];
  async function qishuiGuardHeaders(credential, path) {
    for (const key of GUARD_KEYS) {
      const value = credential?.[key];
      if (typeof value !== "string" || !value || value.length > 16384) {
        throw new Error("invalid guard credential");
      }
    }
    const privateKey = await importPrivateKeyPem(credential.guardKey);
    const timestamp = Math.floor(Date.now() / 1e3);
    const content = `ticket=${credential.ticket}&path=${QISHUI_PREFIX}${path}&timestamp=${timestamp}`;
    return {
      "access-token": credential.ticket,
      "bd-ticket-guard-version": "1",
      "bd-ticket-guard-client-cert": credential.guardCert,
      "bd-ticket-guard-client-data": bytesToBase64(utf8Bytes(JSON.stringify({
        ts_sign: credential.guardTsSign,
        req_content: "ticket,path,timestamp",
        req_sign: await signTextDerBase64(privateKey, content),
        timestamp
      })))
    };
  }
  function readQishuiGuard(raw) {
    if (typeof raw !== "string" || !raw) throw new Error("guard header is missing");
    if (raw.length > 65536) throw new Error("guard header is too large");
    let json;
    try {
      json = JSON.parse(new TextDecoder().decode(base64ToBytes(raw)));
    } catch (_) {
      throw new Error("guard header is not base64 JSON");
    }
    for (const key of ["ticket", "ts_sign", "client_cert"]) {
      if (typeof json[key] !== "string" || !json[key] || json[key].length > 16384) {
        throw new Error(`guard header field missing or invalid: ${key}`);
      }
    }
    const cert = json.client_cert;
    return {
      ticket: json.ticket,
      guardTsSign: json.ts_sign,
      guardCert: cert.includes("-----BEGIN") ? bytesToBase64(utf8Bytes(cert)) : cert
    };
  }
  function qishuiCredentialExpiry(raw) {
    const value = Number(raw || 0);
    const expires = value > 1e12 ? value : value > 1e9 ? value * 1e3 : value > 0 ? Date.now() + value * 1e3 : Date.now() + 6 * 36e5;
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("invalid credential expiry");
    return new Date(expires);
  }
  var isAccountId = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/u.test(value);
  var newQrKey = () => randomHex(16);

  // src/car/client.js
  var QishuiError = class extends Error {
    constructor(code, message, upstreamCode) {
      super(message);
      this.code = code;
      this.upstreamCode = upstreamCode;
    }
  };
  var AUTH_CODES = [28001003, 28001007, 28001008, 10007];
  var RETRYABLE_READS = /* @__PURE__ */ new Set([
    "/search/",
    "/playlist/detail/",
    "/media/mget/",
    "/media/mcheck/",
    "/artist/detail/",
    "/artist/tracks/",
    "/feed/mode/",
    "/feed/song-tab/",
    "/me/playlist/",
    "/me/collection/mixed/",
    "/me/recent-played/"
  ]);
  function checked(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new QishuiError("invalid-response", "Invalid Qishui response");
    }
    const code = Number(data.err_no ?? data.data?.error_code ?? 0);
    if (code) {
      const nested = data.data && typeof data.data === "object" ? data.data : null;
      const detail = [
        data.status_msg,
        data.message,
        data.description,
        nested?.description,
        nested?.message,
        nested?.status_msg
      ].map((value) => typeof value === "string" ? value.trim() : "").find(Boolean) || "";
      throw new QishuiError(
        AUTH_CODES.includes(code) ? "auth-required" : "unavailable",
        detail ? `Qishui rejected the request: ${detail.slice(0, 200)}` : "Qishui rejected the request",
        String(code)
      );
    }
    return data;
  }
  var HOSTS = [
    "365yg.com",
    "douyinvod.com",
    "douyinscdn.com",
    "bytefcdn.com",
    "bytecdn.cn",
    "byteicdn.com",
    "ibytedtos.com",
    "pstatp.com",
    "snssdk.com",
    "bytedance.com",
    "bytetos.com",
    "volcvideo.com",
    "volccdn.com",
    "volces.com",
    "volcengineapi.com",
    "douyin.com",
    "qishui.com",
    "zijieapi.com"
  ];
  function mediaUrl(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch (_) {
      throw new QishuiError("invalid-response", "Invalid Qishui media URL");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new QishuiError("invalid-response", "Untrusted Qishui media host");
    }
    return url.href;
  }
  function createClient({ sessions, fetch: fetcher }) {
    let tokenEntry;
    async function http(url, { body, headers = {}, form = false } = {}) {
      let response;
      try {
        response = await fetcher(url, {
          method: body === void 0 ? "GET" : "POST",
          headers: {
            "user-agent": QISHUI_UA,
            ...body === void 0 ? {} : { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
            ...headers
          },
          ...body === void 0 ? {} : { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }
        });
      } catch (_) {
        throw new QishuiError("network", "Qishui service could not be reached");
      }
      if (!response.ok) {
        const status = Number(response.status);
        throw new QishuiError(
          status === 429 ? "unavailable" : [401, 403].includes(status) ? "auth-required" : "network",
          `Qishui HTTP ${status}`
        );
      }
      try {
        return { data: checked(await response.json()), headers: response.headers };
      } catch (error) {
        if (error instanceof QishuiError) throw error;
        throw new QishuiError("invalid-response", "Qishui response is not JSON");
      }
    }
    const query = (path, extras = {}, deviceId = sessions.deviceId) => {
      const values = new URLSearchParams(qishuiParams(deviceId));
      Object.entries(extras || {}).forEach(([key, value]) => values.set(key, String(value)));
      return `${path}?${values}`;
    };
    const clientToken = () => {
      if (!tokenEntry) {
        const entry = {};
        entry.task = http(query(`${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/client/token/get/`, { trigger_type: "cold_start" })).then(({ data }) => {
          if (typeof data.client_token !== "string" || !data.client_token) {
            throw new QishuiError("invalid-response", "Client token is missing");
          }
          return data.client_token;
        }).catch((error) => {
          if (tokenEntry === entry) tokenEntry = void 0;
          throw error;
        });
        tokenEntry = entry;
      }
      return tokenEntry;
    };
    async function platform(path, body = {}, credential) {
      if (credential === true) {
        credential = sessions.get();
        if (!credential) throw new QishuiError("auth-required", "Sign in to Qishui first");
      }
      const account = credential || sessions.get();
      const revision = sessions.revision;
      const request2 = async (headers) => {
        const { data } = await http(query(`${QISHUI_DOUYIN_HOST}${QISHUI_PREFIX}${path}`, {}, account?.deviceId), {
          body: { ...body, common_params: { ...account?.userId ? { user_id: account.userId } : {} } },
          headers
        });
        if (!data.data || typeof data.data !== "object") throw new QishuiError("invalid-response", "Qishui data is missing");
        return data.data;
      };
      if (credential) return request2(await qishuiGuardHeaders(credential, path));
      let token = clientToken();
      for (let attempt = 0; ; attempt++) {
        const headers = { "access-token": await token.task };
        if (attempt && revision !== sessions.revision) {
          throw new QishuiError("unavailable", "Qishui account changed during the request");
        }
        try {
          return await request2(headers);
        } catch (error) {
          if (!(error instanceof QishuiError) || error.upstreamCode !== "28001008") throw error;
          if (tokenEntry === token) tokenEntry = void 0;
          if (attempt || !RETRYABLE_READS.has(path)) throw error;
          token = tokenEntry || (token.replacement ||= clientToken());
        }
      }
    }
    async function command(path, body = {}) {
      const credential = sessions.get();
      if (!credential) throw new QishuiError("auth-required", "Sign in to Qishui first");
      const { data } = await http(query(`${QISHUI_DOUYIN_HOST}${QISHUI_PREFIX}${path}`, {}, credential.deviceId), {
        body: { ...body, common_params: { ...credential.userId ? { user_id: credential.userId } : {} } },
        headers: await qishuiGuardHeaders(credential, path)
      });
      return data.data && typeof data.data === "object" ? data.data : {};
    }
    return { http, query, platform, command, sessions };
  }

  // src/car/storage.js
  var PREFIX = "folia:qishui:car:";
  var memory = /* @__PURE__ */ new Map();
  function native() {
    try {
      const host = typeof window !== "undefined" ? window.FoliaQishuiHost : null;
      if (!host || typeof host.getStore !== "function" || typeof host.putStore !== "function") return null;
      return host;
    } catch (_) {
      return null;
    }
  }
  function local() {
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch (_) {
      return null;
    }
  }
  var lastRead = "none";
  var lastWrite = "none";
  var lastParseError = "";
  var storageMode = () => lastRead;
  var storageWriteMode = () => lastWrite;
  var storageParseError = () => lastParseError;
  function whereIs(key) {
    const host = native();
    if (host) {
      try {
        if (host.getStore(key)) return "native";
      } catch (_) {
      }
    }
    const target = local();
    if (target) {
      try {
        if (target.getItem(PREFIX + key) != null) return "local";
      } catch (_) {
      }
    }
    return memory.has(key) ? "memory" : "none";
  }
  function readJson(key, fallback = null) {
    const host = native();
    if (host) {
      try {
        const text3 = host.getStore(key);
        if (text3) {
          lastRead = "native";
          try {
            return JSON.parse(text3);
          } catch (error) {
            lastParseError = `native/${key}: ${error?.message || error}`;
          }
        }
      } catch (_) {
      }
    }
    const target = local();
    if (target) {
      try {
        const text3 = target.getItem(PREFIX + key);
        if (text3 != null) {
          lastRead = "local";
          try {
            return JSON.parse(text3);
          } catch (error) {
            lastParseError = `local/${key}: ${error?.message || error}`;
          }
        }
      } catch (_) {
      }
    }
    if (memory.has(key)) {
      lastRead = "memory";
      return memory.get(key);
    }
    lastRead = "none";
    return fallback;
  }
  function writeJson(key, value) {
    const text3 = JSON.stringify(value == null ? null : value);
    memory.set(key, value);
    const host = native();
    if (host) {
      try {
        host.putStore(key, text3);
        lastWrite = "native";
      } catch (_) {
      }
    }
    const target = local();
    if (target) {
      try {
        target.setItem(PREFIX + key, text3);
        if (lastWrite !== "native") lastWrite = "local";
      } catch (_) {
      }
    }
    if (lastWrite === "none") lastWrite = "memory";
  }
  function remove(key) {
    memory.delete(key);
    const host = native();
    if (host) {
      try {
        host.putStore(key, null);
      } catch (_) {
      }
    }
    const target = local();
    if (target) {
      try {
        target.removeItem(PREFIX + key);
      } catch (_) {
      }
    }
  }
  var DEVICE_KEY = "device-id";
  var SESSION_KEY = "session";

  // src/car/auth.js
  var QR_TTL_MS = 5 * 60 * 1e3;
  function createSessions() {
    let deviceId = readJson(DEVICE_KEY, null);
    const deviceIdReused = typeof deviceId === "string" && /^\d{19}$/.test(deviceId);
    if (!deviceIdReused) {
      deviceId = randomDigits19();
      writeJson(DEVICE_KEY, deviceId);
    }
    let current = readJson(SESSION_KEY, null);
    let reread = false;
    let revision = 0;
    return {
      deviceId,
      deviceIdReused,
      get revision() {
        return revision;
      },
      get() {
        if (!current && !reread) {
          reread = true;
          current = readJson(SESSION_KEY, null) || null;
        }
        return current;
      },
      set(value) {
        current = value;
        revision++;
        if (value) writeJson(SESSION_KEY, value);
        else remove(SESSION_KEY);
      },
      clear() {
        current = null;
        revision++;
        remove(SESSION_KEY);
      }
    };
  }
  function createAuth(client, { log = () => {
  } } = {}) {
    const pending = /* @__PURE__ */ new Map();
    let generation = 0;
    let refreshing;
    const { http, query, platform, sessions } = client;
    const clean = () => {
      for (const [key, value] of pending) {
        if (value.expires <= Date.now()) pending.delete(key);
      }
    };
    const step = async (stage, run) => {
      try {
        return await run();
      } catch (error) {
        const failure = error instanceof QishuiError ? error : new QishuiError(
          "invalid-response",
          String(error?.message || error) || "Qishui sign-in response could not be read"
        );
        failure.stage ||= stage;
        throw failure;
      }
    };
    const getUser = (credential) => step("account", async () => {
      const { my_info: user } = await platform("/me/info/", {}, credential);
      if (!isAccountId(user?.id)) throw new QishuiError("invalid-response", "Qishui did not identify the account");
      return {
        id: String(user.id),
        nickname: String(user.nickname || ""),
        avatar: user.medium_avatar_url || user.avatar_url || user.thumb_avatar_url,
        isVip: user.is_vip === true
      };
    });
    async function ticket(access, guard, deviceId) {
      if (!access.access_code) throw new QishuiError("invalid-response", "Access code is missing");
      const response = await http(`${QISHUI_OPEN_CLIENT_HOST}/passport/open/get_access_ticket/?${new URLSearchParams({ aid: "1128", client_key: QISHUI_CLIENT_KEY, device_platform: "android" })}`, {
        body: { access_code: access.access_code, open_id: String(access.open_id || access.open_uid || "") },
        form: true,
        headers: {
          "bd-ticket-guard-version": "1",
          ...guard.csr ? { "bd-ticket-guard-client-csr": guard.csr } : { "bd-ticket-guard-client-cert": guard.guardCert }
        }
      });
      const guardHeader = response.headers.get("bd-ticket-guard-server-data");
      let guardData;
      try {
        guardData = readQishuiGuard(guardHeader);
      } catch (error) {
        const names = typeof response.headers.names === "function" ? response.headers.names() : [];
        const related = names.filter((name) => /ticket-guard/i.test(String(name)));
        throw new Error(`readQishuiGuard failed (${String(error?.message || error)}); http=${response.status ?? "?"} headers=[${names.join(" ") || "none"}] guardHeaders=[${related.join(" ") || "none"}] rawLength=${guardHeader ? String(guardHeader.length) : "0"}`);
      }
      return {
        deviceId,
        guardKey: guard.guardKey,
        ...guardData,
        accessCode: access.access_code,
        openId: String(access.open_id || access.open_uid || ""),
        expiresAt: qishuiCredentialExpiry(access.expires_time).getTime()
      };
    }
    async function renew() {
      const old = sessions.get();
      if (!old) return null;
      const revision = sessions.revision;
      let candidate = old;
      if (Number(old.expiresAt) < Date.now() + 36e5) {
        const result = await http(query(
          `${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/access/code/refresh/`,
          { access_code: old.accessCode },
          old.deviceId
        ));
        const access = result.data.data || result.data;
        candidate = await ticket({ ...access, open_id: access.open_id || access.open_uid || old.openId }, old, old.deviceId);
      }
      const user = await getUser(candidate);
      if (user.id !== old.userId) throw new QishuiError("auth-required", "Qishui account identity changed");
      if (revision !== sessions.revision) return null;
      sessions.set({ ...candidate, userId: user.id, user });
      return user;
    }
    return {
      async start() {
        clean();
        pending.clear();
        const mine = ++generation;
        const result = await http(`${QISHUI_DOUYIN_HOST}/oauth/get_qrcode/?${new URLSearchParams(qrParams())}`);
        const data = result.data.data;
        if (!data?.token || !data.qrcode) throw new QishuiError("invalid-response", "QR code is missing");
        if (mine !== generation) throw new QishuiError("unavailable", "Sign-in was cancelled");
        const key = newQrKey();
        pending.set(key, { token: data.token, qr: `data:image/png;base64,${data.qrcode}`, expires: Date.now() + QR_TTL_MS });
        log("[Qishui] Sign-in QR created");
        return { key, imageUrl: `data:image/png;base64,${data.qrcode}` };
      },
      qr(key) {
        clean();
        const value = pending.get(key);
        if (!value) throw new QishuiError("unavailable", "QR session expired");
        return { imageUrl: value.qr };
      },
      async check(key) {
        clean();
        const value = pending.get(key);
        if (!value) return { state: "expired" };
        if (value.task) return value.task;
        const revision = sessions.revision;
        const run = async () => {
          const result = await http(`${QISHUI_DOUYIN_HOST}/oauth/check_qrcode/?${new URLSearchParams({ ...qrParams(), token: value.token, timestamp: String(Date.now()) })}`);
          const data = result.data.data;
          if (!data || !["new", "scanned", "confirmed", "expired", "refused"].includes(data.status)) {
            throw new QishuiError("invalid-response", "Invalid QR status");
          }
          if (data.status !== "confirmed") {
            if (["expired", "refused"].includes(data.status)) pending.delete(key);
            return data.status === "refused" ? { state: "error", failure: { case: "refused" } } : { state: data.status === "new" ? "waiting" : data.status };
          }
          const code = data.code || data.auth_code;
          if (!code) throw new QishuiError("invalid-response", "QR authorization code is missing");
          const access = await step("access-code", async () => {
            const response = await http(query(`${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/access/code/get/`, { auth_code: code }));
            return response.data.data || response.data;
          });
          const credential = await step("ticket", async () => ticket(access, await createGuard(), sessions.deviceId));
          const user = await getUser(credential);
          if (pending.get(key) !== value || sessions.revision !== revision) return { state: "expired" };
          sessions.set({ ...credential, userId: user.id, user });
          pending.delete(key);
          log("[Qishui] Sign-in confirmed; account stored");
          return { state: "confirmed" };
        };
        value.task = run().finally(() => {
          value.task = void 0;
        });
        return value.task;
      },
      cancel(key) {
        pending.delete(key);
      },
      logout() {
        generation++;
        pending.clear();
        sessions.clear();
        log("[Qishui] Signed out");
      },
      status() {
        if (!refreshing) refreshing = renew().finally(() => {
          refreshing = void 0;
        });
        return refreshing;
      }
    };
  }

  // src/car/shape.js
  var text = (value) => value == null ? "" : String(value);
  function coverFromUrlInfo(info) {
    if (!info || typeof info !== "object") return "";
    const urls = Array.isArray(info.urls) ? info.urls : [];
    const prefix = urls.find((value) => typeof value === "string" && /^https?:\/\//.test(value)) || "";
    const uri = text(info.uri);
    if (!prefix || !uri) return "";
    return prefix + uri + "~c5_300x300.jpeg";
  }
  function collectionCover(entity) {
    const display = entity.display_info || {};
    return coverFromUrlInfo(display.url_cover || display.display && display.display.url_cover) || coverFromUrlInfo(entity.cover_url);
  }
  function trackEntity(raw) {
    const candidates = [
      raw?.track_entity,
      raw?.entity?.media?.track_entity,
      raw?.entity?.track,
      raw?.media?.track_entity,
      raw?.track,
      raw
    ];
    for (const candidate of candidates) {
      if (candidate && (candidate.base_info?.id || candidate.id)) return candidate;
    }
    return null;
  }
  function toFoliaSong(raw) {
    const track = trackEntity(raw);
    if (!track) return null;
    const base = track.base_info || {};
    const id = text(base.id || track.id);
    if (!id) return null;
    const related = track.related_info || {};
    const album = related.album_link || {};
    const artists = (Array.isArray(related.artist_links) ? related.artist_links : []).map((item) => ({
      id: text(item?.id),
      name: text(item?.name || item?.simple_display_name)
    })).filter((item) => item.name);
    const display = track.display_info || {};
    const durationMs = Number(base.duration_ms || 0);
    return {
      id,
      name: text(base.name),
      artist: artists.map((item) => item.name).join(" / "),
      artistId: artists.length ? artists[0].id : "",
      artists,
      album: text(album.name),
      albumId: text(album.id),
      cover: coverFromUrlInfo(display.cover_url || display.display && display.display.cover_url),
      // 渲染层拿到秒再乘 1000，所以这里给秒（保留小数）。
      duration: durationMs > 0 ? durationMs / 1e3 : 0,
      fee: 0,
      playbackMode: "direct-url"
    };
  }
  function toFoliaSongs(items) {
    return (Array.isArray(items) ? items : []).map(toFoliaSong).filter(Boolean);
  }
  function toFoliaPlaylist(raw, options = {}) {
    const entity = raw?.playlist || raw || {};
    const base = entity.base_info || {};
    const id = text(base.id || entity.id);
    if (!id) return null;
    const cover = collectionCover(entity);
    const counts = entity.resource_cnt && typeof entity.resource_cnt === "object" ? entity.resource_cnt : {};
    const trackCount = Number(counts.track_cnt ?? counts.media_count ?? entity.resource_cnt ?? entity.stats?.count_tracks ?? base.count_tracks ?? 0);
    return {
      id,
      name: text(base.title || base.name || entity.title),
      cover,
      description: text(base.desc || base.description),
      trackCount: Number.isFinite(trackCount) ? trackCount : 0,
      creator: base.owner_id ? { id: text(base.owner_id), nickname: "" } : void 0,
      artists: [],
      isOwned: options.isOwned !== void 0 ? Boolean(options.isOwned) : void 0,
      owned: options.isOwned !== void 0 ? Boolean(options.isOwned) : void 0,
      // 我的喜欢（type 1）在渲染层有固定 id，协议层这里标一下便于排查。
      // ownerId 必须带上：/playlist/detail/ 要它，换封面那一步也要靠它读第一首。
      providerData: { carType: Number(base.type) || 0, ownerId: text(base.owner_id) }
    };
  }
  function toFoliaPlaylists(items) {
    return (Array.isArray(items) ? items : []).map((item) => toFoliaPlaylist(item, { isOwned: item?.isOwned })).filter(Boolean);
  }
  function lrcTime(ms) {
    const total = Math.max(0, Number(ms) || 0);
    const minutes = Math.floor(total / 6e4);
    const seconds = Math.floor(total % 6e4 / 1e3);
    const centiseconds = Math.floor(total % 1e3 / 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }
  function lyricsFromContent(content) {
    const lrcLines = [];
    const yrcLines = [];
    String(content || "").split("\n").forEach((rawLine) => {
      const line = String(rawLine || "").trim();
      const timed = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!timed) return;
      const lineStart = Math.max(0, Number(timed[1]) || 0);
      const lineDuration = Math.max(0, Number(timed[2]) || 0);
      const body = timed[3] || "";
      const wordPattern = /([<(])(\d+),(\d+),(\d+)[>)]([^<(]*)/g;
      let match;
      let plain = "";
      let yrcBody = "";
      while (match = wordPattern.exec(body)) {
        const rawStart = Math.max(0, Number(match[2]) || 0);
        const wordDuration = Math.max(0, Number(match[3]) || 0);
        const word = String(match[5] || "");
        if (!word) continue;
        const absolute = match[1] === "<" ? lineStart + rawStart : rawStart >= Math.max(0, lineStart - 500) ? rawStart : lineStart + rawStart;
        plain += word;
        yrcBody += `(${absolute},${wordDuration},${Number(match[4]) || 0})${word}`;
      }
      if (!plain) plain = body.replace(/[<(]\d+,\d+,\d+[>)]/g, "").trim();
      if (!plain) return;
      lrcLines.push(`[${lrcTime(lineStart)}]${plain}`);
      if (yrcBody) yrcLines.push(`[${lineStart},${lineDuration}]${yrcBody}`);
    });
    return { lyric: lrcLines.join("\n"), yrc: yrcLines.join("\n"), tlyric: "" };
  }
  function lyricsFromTrack(raw) {
    const track = trackEntity(raw);
    const entity = track?.display_info?.lyric_info?.lyric_entity || track?.lyric_info?.lyric_entity;
    return lyricsFromContent(entity?.content);
  }

  // src/car/catalog.js
  var array = (value, field) => {
    if (!Array.isArray(value)) throw new QishuiError("invalid-response", `Qishui ${field} is missing`);
    return value;
  };
  async function search(platform, query, type, limit, offset) {
    const items = [];
    const searchId = randomHex(16);
    let cursor = offset;
    let more = false;
    while (items.length < limit) {
      const data = await platform("/search/", {
        q: query,
        cursor: String(cursor),
        search_id: searchId,
        from_search_id: searchId,
        search_method: "input",
        search_type: type,
        search_scene: "normal",
        scene_name: "search",
        ab_param: "",
        last_viewed_media: {}
      });
      const groups = array(data.result_groups, "search groups");
      const group = groups.find((value) => value.id === `${type}s`) || groups[0];
      if (!group) break;
      const batch = array(group.data, "search items").map((value) => value.entity?.[type]).filter(Boolean);
      const remaining = limit - items.length;
      items.push(...batch.slice(0, remaining));
      more = batch.length > remaining || group.has_more === true;
      if (!batch.length || !more || items.length === limit) break;
      const next = Number(group.next_cursor);
      if (!Number.isSafeInteger(next) || next <= cursor) break;
      cursor = next;
    }
    return { items, hasMore: more && items.length > 0, nextOffset: offset + items.length };
  }
  async function playlistPage(platform, id, ownerId, limit, offset, count = 100) {
    let cursor = "0";
    let consumed = 0;
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    let collection;
    let hasMore = false;
    while (items.length < limit && seen.size < 500) {
      seen.add(cursor);
      const data = await platform("/playlist/detail/", {
        playlist_id: id,
        owner_id: ownerId || "",
        count,
        cursor,
        type: null
      });
      collection ||= data.playlist;
      const batch = array(data.media_entities, "playlist tracks");
      const start = Math.max(0, offset - consumed);
      const remaining = limit - items.length;
      items.push(...batch.slice(start, start + remaining).map(trackEntity));
      consumed += batch.length;
      const next = String(data.next_cursor ?? "");
      const upstreamMore = data.has_more === true;
      hasMore = consumed > offset + items.length || upstreamMore;
      if (!upstreamMore || items.length === limit) break;
      if (!batch.length || !next || seen.has(next)) throw new QishuiError("invalid-response", "Playlist cursor did not advance");
      cursor = next;
    }
    return { items, collection, hasMore: hasMore && items.length > 0, nextOffset: offset + items.length };
  }
  async function likedPlaylist(platform) {
    let cursor = "";
    const seen = /* @__PURE__ */ new Set();
    for (let page = 0; page < 20; page++) {
      seen.add(cursor);
      const data = await platform("/me/playlist/", { count: 100, cursor, item_types: ["playlist"] }, true);
      const rows = Array.isArray(data.playlists) ? data.playlists : Array.isArray(data.playlist_list) ? data.playlist_list : null;
      if (!rows) throw new QishuiError("invalid-response", "Qishui account playlists is missing");
      for (const row of rows) {
        const playlist = row?.playlist || row || {};
        const base = playlist.base_info || {};
        if (Number(base.type) === 1 && base.id) {
          return { id: String(base.id), ownerId: String(base.owner_id || "") };
        }
      }
      if (data.has_more !== true) return null;
      const next = String(data.next_cursor ?? "");
      if (!next || seen.has(next)) throw new QishuiError("invalid-response", "Account playlist cursor did not advance");
      cursor = next;
    }
    throw new QishuiError("invalid-response", "Account playlist page limit reached");
  }
  function createCatalog({ platform }) {
    return {
      searchSongs: ({ query, limit, offset }) => search(platform, query, "track", limit, offset),
      searchPlaylists: ({ query, limit, offset }) => search(platform, query, "playlist", limit, offset),
      /**
       * 完整 track entity（含 player_info，播放要用），不裁剪。
       *
       * `credential` 传凭据就走账号那条路（ticket-guard 签名）—— 见 api.js 的
       * `accountTrack`：受版权保护的曲子用公共客户端令牌问，上游**根本不给 full**
       * （player_info 里只有 preview），表现是「每首歌都 only offers a preview」。
       */
      async track(id, options = {}) {
        const data = await platform(
          "/media/mget/",
          { media_list: [{ id, type: "track" }], card_context: {} },
          options.credential
        );
        const media = array(data.media_list, "media list").find((item) => String(item.media_id || item.track_entity?.base_info?.id) === id);
        if (!media?.track_entity) throw new QishuiError("not-playable", "Qishui did not return the track");
        return media.track_entity;
      },
      playlistTracks: ({ id, ownerId, limit, offset, count }) => playlistPage(platform, id, ownerId, limit, offset, count),
      async userPlaylists({ limit, offset }) {
        const items = [];
        for (const [path, field, owned] of [
          ["/me/playlist/", "playlists", true],
          ["/me/collection/mixed/", "mixed_collections", false]
        ]) {
          let cursor = "";
          const seen = /* @__PURE__ */ new Set();
          for (let page = 0; page < 500; page++) {
            seen.add(cursor);
            const data = await platform(path, { count: 100, cursor, item_types: ["playlist"] }, true);
            const rows = Array.isArray(data[field]) ? data[field] : path === "/me/playlist/" ? data.playlist_list : void 0;
            if (Array.isArray(rows)) {
              for (const row of rows) {
                const playlist = row?.playlist || row;
                if (playlist?.base_info?.id) items.push({ ...playlist, isOwned: owned });
              }
            }
            if (data.has_more !== true) break;
            const next = String(data.next_cursor ?? "");
            if (!next || seen.has(next) || !rows || !rows.length || page === 499) {
              throw new QishuiError("invalid-response", "Account playlist cursor did not advance");
            }
            cursor = next;
          }
        }
        const unique = [...new Map(items.map((item) => [String(item.base_info.id), item])).values()];
        return {
          items: unique.slice(offset, offset + limit),
          total: unique.length,
          nextOffset: offset + Math.min(limit, Math.max(0, unique.length - offset)),
          hasMore: offset + limit < unique.length
        };
      },
      async artistDetail({ id }) {
        const data = await platform("/artist/detail/", { artist_id: id });
        return data.artist_info;
      },
      async artistSongs({ id, limit, offset }) {
        const data = await platform("/artist/tracks/", { artist_id: id, count: 50, cursor: "0" });
        const tracks = array(data.tracks, "artist tracks").map(trackEntity);
        return {
          items: tracks.slice(offset, offset + limit),
          total: tracks.length,
          nextOffset: Math.min(offset + limit, tracks.length),
          hasMore: offset + limit < tracks.length
        };
      }
    };
  }

  // src/car/feed.js
  function createFeed({ platform }) {
    const queues = /* @__PURE__ */ new Map();
    let total = 0;
    let generation = 0;
    const activeKeys = /* @__PURE__ */ new Map();
    let pending = Promise.resolve();
    return {
      clear() {
        generation++;
        queues.clear();
        activeKeys.clear();
        total = 0;
      },
      async modes() {
        const data = await platform("/feed/mode/");
        return (data.feed_mode_block || []).flatMap((block) => (block.feed_mode || []).flatMap((item) => {
          const mode = item.entity?.feed_mode;
          const id = mode?.scene_mode?.scene_mode_id;
          return id == null ? [] : [{
            id: String(id),
            name: String(mode.text || ""),
            group: String(block.title || ""),
            coverUrl: mode.url_info
          }];
        }));
      },
      songs(options = {}) {
        const mine = generation;
        const run = async () => {
          if (mine !== generation) throw new QishuiError("unavailable", "Qishui account changed");
          const { scene, preference, queue = "fm", first = false, count = 20 } = options;
          if (scene != null && preference) {
            throw new QishuiError("invalid-response", "Scene and preference are mutually exclusive");
          }
          if (scene != null && (!/^\d+$/.test(String(scene)) || !Number.isSafeInteger(Number(scene)))) {
            throw new QishuiError("invalid-response", "Invalid scene");
          }
          const key = `${queue}:${scene ?? preference ?? "default"}`;
          if (queues.size > 100) queues.clear();
          const previous = queues.get(key);
          const state = first || !previous || activeKeys.get(queue) !== key ? { count: 0, selectedAt: Date.now() } : previous;
          const data = await platform("/feed/song-tab/", {
            played_media: [],
            is_first_request: state.count === 0,
            with_client_cache: state.count !== 0,
            is_did_first_request: false,
            count,
            feed_preference: {
              scene_mode_id: scene == null ? null : Number(scene),
              scene_mode_select_time: scene == null ? null : state.selectedAt,
              preference_mode: preference || null,
              total_request_count: ++total,
              preference_mode_request_count: state.count + 1,
              current_mode_request_count: state.count + 1
            }
          });
          if (!Array.isArray(data.items)) throw new QishuiError("invalid-response", "Qishui feed items are missing");
          if (mine !== generation) throw new QishuiError("unavailable", "Qishui account changed");
          activeKeys.set(queue, key);
          state.count++;
          queues.set(key, state);
          return {
            items: data.items.filter((item) => !item.type || item.type === "track").map(trackEntity),
            hasMore: data.has_more === true
          };
        };
        const result = pending.then(run, run);
        pending = result.catch(() => {
        });
        return result;
      }
    };
  }

  // src/car/library.js
  var MAX_BATCH = 100;
  var PAGE_SIZE = 100;
  var PAGE_LIMIT = 500;
  var mediaId = (value) => {
    if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) {
      throw new QishuiError("invalid-response", "Invalid Qishui media ID");
    }
    return value;
  };
  var mediaIds = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new QishuiError("invalid-response", "Qishui media IDs are required");
    }
    if (value.length > MAX_BATCH) {
      throw new QishuiError("unsupported", `Select at most ${MAX_BATCH} tracks per operation`);
    }
    return [...new Set(value.map(mediaId))];
  };
  var trackRef = (id) => ({ id, type: "track" });
  var requiredList = (data, fields, label) => {
    const rows = fields.map((field) => data?.[field]).find(Array.isArray);
    if (!rows) throw new QishuiError("invalid-response", `Qishui ${label} is missing`);
    return rows;
  };
  async function likedSongs(platform) {
    const liked = await likedPlaylist(platform);
    if (!liked) return { ids: [], whole: true, total: 0 };
    const ids = /* @__PURE__ */ new Set();
    let cursor = "";
    let whole = false;
    const seen = /* @__PURE__ */ new Set();
    for (let page = 0; page < PAGE_LIMIT; page++) {
      seen.add(cursor);
      const data = await platform("/playlist/detail/", {
        playlist_id: liked.id,
        owner_id: liked.ownerId,
        count: PAGE_SIZE,
        cursor,
        type: 1
      });
      const media = requiredList(data, ["media_entities", "media_list"], "liked playlist tracks");
      for (const item of media) {
        const entity = trackEntity(item);
        if (entity?.base_info?.id) ids.add(String(entity.base_info.id));
      }
      if (data.has_more !== true) {
        whole = true;
        break;
      }
      const next = String(data.next_cursor ?? "");
      if (!next || seen.has(next)) throw new QishuiError("invalid-response", "Liked playlist cursor did not advance");
      cursor = next;
    }
    return { ids: [...ids], whole, total: ids.size };
  }
  async function recentPlayed(platform, limit, offset) {
    const items = [];
    let cursor = "";
    let consumed = 0;
    let hasMore = false;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const data = await platform("/me/recent-played/", {
        count: PAGE_SIZE,
        cursor,
        media_type: "track",
        scene: "me_tab"
      }, true);
      const rows = Array.isArray(data.media) ? data.media : [];
      for (const row of rows) {
        const entity = trackEntity(row?.media);
        if (!entity) continue;
        const rawPlayedAt = Number(row.play_start_timestamp);
        const playedAt = rawPlayedAt > 1e12 ? rawPlayedAt : rawPlayedAt * 1e3;
        if (consumed >= offset && items.length < limit) {
          items.push({ ...entity, ...Number.isFinite(playedAt) && playedAt > 0 ? { playedAt } : {} });
        }
        consumed++;
      }
      const upstreamMore = data.has_more === true;
      hasMore = consumed > offset + items.length || upstreamMore;
      if (!upstreamMore || items.length >= limit) break;
      const next = String(data.next_cursor ?? "");
      if (!next || next === cursor) throw new QishuiError("invalid-response", "Recent-played cursor did not advance");
      cursor = next;
    }
    return { items, hasMore: hasMore && items.length > 0, nextOffset: offset + items.length };
  }
  async function checkTracks(platform, ids) {
    const data = await platform("/media/mcheck/", { media_list: ids.map(trackRef) });
    const rows = Array.isArray(data.media_status_list) ? data.media_status_list : [];
    return {
      statuses: rows.map((row) => ({
        id: String(row.id ?? ""),
        riskResult: Number(row.risk_info?.risk_result ?? -1),
        status: Number(row.risk_info?.status ?? 0)
      }))
    };
  }
  function createLibrary(client) {
    const { platform, command } = client;
    return {
      likedSongs: () => likedSongs(platform),
      recentPlayed: ({ limit = 30, offset = 0 } = {}) => recentPlayed(platform, limit, offset),
      checkTracks: ({ ids }) => checkTracks(platform, mediaIds(ids)),
      async likeSong({ id, liked }) {
        const trackId = mediaId(id);
        if (liked === false) {
          await command("/media/cancel/collect/", { media: [trackRef(trackId)] });
        } else {
          await command("/media/collect/", { media: [trackRef(trackId)], scene: "", collect_action: 1 });
        }
      },
      async editPlaylist({ operation, id, ids }) {
        const playlistId = mediaId(id);
        const tracks = mediaIds(ids);
        const path = operation === "add" ? "/playlist/append/" : "/playlist/delete/";
        if (operation !== "add" && operation !== "remove") {
          throw new QishuiError("unsupported", "Unsupported playlist operation");
        }
        await command(path, { playlist_id: playlistId, media: tracks.map(trackRef) });
      },
      async dislikeSong({ id, disliked }) {
        const trackId = mediaId(id);
        await command("/dislike/", {
          item_id: trackId,
          author_ids: [],
          dislike_item_type: "track",
          action_type: disliked ? 0 : 1
        });
      }
    };
  }

  // src/car/playback.js
  var levels = { medium: "standard", higher: "high", highest: "high", lossless: "lossless", hi_res: "hires" };
  var rank = (value) => ["standard", "high", "lossless", "hires"].indexOf(value);
  var encrypted = (item) => Boolean(item.encrypt_info?.encrypt || item.encrypt_info?.spade_a || item.PlayAuth || Number(item.Encrypt || 0));
  var requestedRank = (value) => value === "ultra" ? "lossless" : levels[value] || value || "standard";
  async function resolveAudio(client, track, requested) {
    const player = track?.player_info;
    if (!player) throw new QishuiError("not-playable", "Qishui returned no player information");
    const wanted = rank(requestedRank(requested)) < 0 ? "standard" : requestedRank(requested);
    for (const variant of ["full", "preview"]) {
      const info = player[variant]?.video_model_info;
      if (!info) continue;
      const candidates = [];
      if (info.video_model) {
        let model;
        try {
          model = typeof info.video_model === "string" ? JSON.parse(info.video_model) : info.video_model;
        } catch (_) {
          throw new QishuiError("invalid-response", "Invalid Qishui player model");
        }
        for (const item of model.video_list || []) {
          if (encrypted(item) || !item.main_url) continue;
          candidates.push({
            url: mediaUrl(item.main_url),
            quality: levels[item.video_meta?.quality] || "standard",
            bitrate: Number(item.video_meta?.bitrate || 0)
          });
        }
      }
      if (!candidates.length && info.url_player_info) {
        let list = null;
        try {
          const { data } = await client.http(mediaUrl(info.url_player_info));
          list = data.Result?.Data?.PlayInfoList || data.data?.PlayInfoList || data.PlayInfoList;
        } catch (_) {
          list = null;
        }
        for (const item of Array.isArray(list) ? list : []) {
          if (encrypted(item) || !item.MainPlayUrl) continue;
          candidates.push({
            url: mediaUrl(item.MainPlayUrl),
            quality: levels[item.Quality] || "standard",
            bitrate: Number(item.Bitrate || 0)
          });
        }
      }
      if (!candidates.length) continue;
      const allowed = candidates.filter((item) => rank(item.quality) <= rank(wanted));
      const source = (allowed.length ? allowed : candidates).sort((a, b) => rank(b.quality) - rank(a.quality) || b.bitrate - a.bitrate)[0];
      const clipStartMs = variant === "preview" ? Number(player.preview?.duration?.start_ms) : 0;
      return {
        url: source.url,
        quality: source.quality,
        playable: true,
        trial: variant === "preview",
        fetchedAt: Date.now(),
        ...Number(info.expire_at) > Date.now() / 1e3 ? { expiresAt: Number(info.expire_at) * 1e3 } : {},
        ...Number.isFinite(clipStartMs) && clipStartMs > 0 ? { clipStartMs } : {}
      };
    }
    throw new QishuiError("not-playable", "Qishui returned protected audio only; decryption is disabled");
  }

  // src/car/transport.js
  var DEFAULT_TIMEOUT_MS = 25e3;
  function headerLookup(headers, name) {
    if (!headers) return null;
    const needle = String(name || "").toLowerCase();
    for (const key of Object.keys(headers)) {
      if (String(key).toLowerCase() === needle) return headers[key];
    }
    return null;
  }
  function wrapResponse(native2) {
    const headers = native2 && native2.headers || {};
    return {
      ok: Number(native2 && native2.status) >= 200 && Number(native2 && native2.status) < 300,
      status: Number(native2 && native2.status) || 0,
      // names() 只给键名不给值：诊断要能看出「头到没到」，但不把凭据带出去。
      headers: { get: (name) => headerLookup(headers, name), names: () => Object.keys(headers || {}) },
      text: async () => String(native2 && native2.body || ""),
      json: async () => JSON.parse(String(native2 && native2.body || "{}"))
    };
  }
  function createFetch(transport) {
    const resolve = () => {
      if (transport && typeof transport.request === "function") return transport;
      const host = typeof window !== "undefined" ? window.__foliaHttpTransport : null;
      if (host && typeof host.request === "function") return host;
      throw new Error("native http transport is unavailable");
    };
    return async function foliaFetch(url, options = {}) {
      const method = String(options.method || (options.body == null ? "GET" : "POST")).toUpperCase();
      const payload = {
        url: String(url),
        method,
        headers: options.headers || {},
        body: options.body == null ? null : String(options.body),
        timeoutMs: DEFAULT_TIMEOUT_MS
      };
      let native2;
      try {
        native2 = await resolve().request(payload);
      } catch (error) {
        throw new Error("network");
      }
      return wrapResponse(native2);
    };
  }

  // src/car/api.js
  var QISHUI_LIKED_ID = "qishui-liked";
  var QISHUI_FEED_ID = "qishui-feed";
  var text2 = (value) => value == null ? "" : String(value);
  function createQishuiCar(options = {}) {
    const fetcher = options.fetch || createFetch(options.transport);
    const sessions = options.sessions || createSessions();
    const client = createClient({ sessions, fetch: fetcher });
    const log = options.log || (() => {
    });
    const auth = createAuth(client, { log });
    const catalog = createCatalog(client);
    const feed = createFeed(client);
    const library = createLibrary(client);
    const { platform } = client;
    let likedReal = null;
    const coverCache = /* @__PURE__ */ new Map();
    const COVER_FALLBACK_BUDGET = 12;
    async function firstTrack(id, ownerId) {
      const key = String(id || "");
      if (!key) return null;
      if (coverCache.has(key)) return coverCache.get(key);
      let found = null;
      try {
        const page = await catalog.playlistTracks({
          id: key,
          ownerId: String(ownerId || ""),
          limit: 1,
          offset: 0,
          count: 1
        });
        const [song] = toFoliaSongs(page.items);
        if (song) found = { cover: song.cover || "", name: song.name || "", artist: song.artist || "" };
      } catch (_) {
        found = null;
      }
      coverCache.set(key, found);
      return found;
    }
    function applyCoverFallback(playlist, track) {
      if (!playlist) return;
      if (track?.cover) {
        playlist.cover = track.cover;
        return;
      }
      if (track?.name) {
        playlist.providerData = {
          ...playlist.providerData || {},
          coverSongName: track.name,
          coverSongArtist: track.artist || ""
        };
      }
    }
    async function accountTrack(id) {
      const credential = sessions.get();
      if (!credential) return catalog.track(id);
      try {
        return await catalog.track(id, { credential });
      } catch (error) {
        log(`[Qishui] account track read failed (${error?.code || "error"}), falling back to the public token`);
        return catalog.track(id);
      }
    }
    async function resolveLiked() {
      if (likedReal) return likedReal;
      likedReal = await likedPlaylist(platform);
      return likedReal;
    }
    const userShape = (user) => user ? {
      id: text2(user.id),
      nickname: text2(user.nickname),
      avatarUrl: coverFromUrlInfo(user.avatar) || (typeof user.avatar === "string" ? user.avatar : ""),
      ...typeof user.isVip === "boolean" ? { vipType: user.isVip ? 1 : 0 } : {}
    } : null;
    return {
      sessions,
      /**
       * 登录态。
       *
       * 判定只认手里有没有 ticket 凭据：车机协议没有 cookie 这一层，旧协议那套
       * 「cookie 里有 sid_tt 就算登录」的坑（sid_tt 登录前就有）在这里不存在。
       * 续期（renew）失败不推翻已登录结论 —— 凭据还没过期就继续用，错误只进诊断。
       */
      async status() {
        const credential = sessions.get();
        const base = {
          provider: "qishui",
          configured: true,
          loggedIn: Boolean(credential?.ticket),
          webSession: Boolean(credential?.ticket),
          cookieReady: Boolean(credential?.ticket),
          protocol: "luna-car",
          scope: QISHUI_QR_SCOPE,
          cookieKeys: "(car-protocol)",
          // 凭据落在哪一档存储：真机上「重启后账号没了」先看这个字段
          // （native=SharedPreferences / local=localStorage / memory=只在这个进程）。
          // ⚠ 这是**读档**：写档几乎恒为 native（设备 ID 每次启动都要写一次），
          // 混着看会被带到错的方向，所以两个分开给。
          storage: storageMode(),
          store: {
            read: storageMode(),
            write: storageWriteMode(),
            session: whereIs("session"),
            deviceId: whereIs("device-id"),
            // 每次启动都重新生成设备 ID＝这一档存储没读出来，凭据当然也没有。
            deviceIdReused: sessions.deviceIdReused === true,
            ...storageParseError() ? { parseError: storageParseError() } : {}
          },
          loginKeys: credential?.ticket ? "ticket=y" : "ticket=n",
          userId: text2(credential?.userId),
          libraryReady: Boolean(credential?.ticket),
          libraryErrors: []
        };
        if (!credential?.ticket) {
          return { ...base, profileReady: false, profile: null, message: "未登录：请用抖音/汽水 App 扫码授权" };
        }
        let user = credential.user || null;
        let profileError = "";
        try {
          const fresh = await auth.status();
          if (fresh) user = fresh;
        } catch (error) {
          profileError = error instanceof QishuiError ? `${error.code}${error.stage ? "/" + error.stage : ""}: ${error.message}` : String(error?.message || error);
          if (Number(credential.expiresAt) > 0 && Number(credential.expiresAt) <= Date.now()) {
            return {
              ...base,
              loggedIn: false,
              webSession: false,
              cookieReady: false,
              profileReady: false,
              profile: null,
              profileError,
              message: "Qishui session expired; scan the QR code again"
            };
          }
        }
        return {
          ...base,
          profileReady: Boolean(user?.id),
          profile: userShape(user),
          ...profileError ? { profileError } : {},
          expiresAt: Number(credential.expiresAt) || 0
        };
      },
      async startLogin() {
        const result = await auth.start();
        return { key: result.key, qrDataUrl: result.imageUrl };
      },
      qr: (key) => auth.qr(key).imageUrl,
      checkLogin: (key) => auth.check(key),
      cancelLogin: (key) => {
        auth.cancel(key);
      },
      logout() {
        auth.logout();
        feed.clear();
        likedReal = null;
        coverCache.clear();
        return { provider: "qishui", loggedIn: false, webSession: false, cookieReady: false, configured: true };
      },
      async search(keywords, limit, offset) {
        const page = await catalog.searchSongs({ query: keywords, limit, offset });
        const songs = toFoliaSongs(page.items);
        return {
          provider: "qishui",
          songs,
          rawCount: page.items.length,
          offset,
          limit,
          nextOffset: page.nextOffset,
          hasMore: page.hasMore
        };
      },
      // 搜索出来的歌单同样带着那个 403 的封面，但一次搜索就是十几张卡片，
      // 逐张再发一次 /playlist/detail/ 换图不划算 —— 点进去看详情时再兜（见上）。
      async searchPlaylists(keywords, limit, offset) {
        const page = await catalog.searchPlaylists({ query: keywords, limit, offset });
        return {
          provider: "qishui",
          playlists: toFoliaPlaylists(page.items),
          nextOffset: page.nextOffset,
          hasMore: page.hasMore
        };
      },
      async songDetail(id) {
        const track = await accountTrack(id);
        return { provider: "qishui", song: toFoliaSong(track) };
      },
      async lyrics(id) {
        const track = await accountTrack(id);
        const lyrics = lyricsFromTrack(track);
        return {
          provider: "qishui",
          lyric: lyrics.lyric,
          yrc: lyrics.yrc,
          tlyric: lyrics.tlyric,
          source: lyrics.lyric || lyrics.yrc ? "luna-car" : "none"
        };
      },
      async audio(id, quality) {
        const track = await accountTrack(id);
        const audio = await resolveAudio(client, track, quality);
        return { provider: "qishui", ...audio };
      },
      /**
       * 我的歌单：真实列表 + 两个虚拟入口（我的喜欢 / 推荐流）。
       * 车机的「我的喜欢」本身就在真实列表里（type 1），这里把它换成统一入口，
       * 免得同一个歌单在界面上出现两次。
       */
      async userPlaylists(limit, offset) {
        const page = await catalog.userPlaylists({ limit: 1e4, offset: 0 });
        const real = page.items.filter((item) => Number(item?.base_info?.type) !== 1);
        const liked = await resolveLiked().catch(() => null);
        const likedTrack = liked ? await firstTrack(liked.id, liked.ownerId) : null;
        const virtual = [
          {
            id: QISHUI_LIKED_ID,
            name: "我的喜欢",
            cover: "",
            description: "",
            trackCount: 0,
            creator: void 0,
            artists: [],
            isOwned: true,
            owned: true,
            virtual: true
          },
          {
            id: QISHUI_FEED_ID,
            name: "汽水推荐",
            cover: "",
            description: "",
            trackCount: 0,
            creator: void 0,
            artists: [],
            isOwned: true,
            owned: true,
            virtual: true,
            playbackMode: "recommend-match"
          }
        ];
        applyCoverFallback(virtual[0], likedTrack);
        const mapped = toFoliaPlaylists(real);
        const pending = [];
        for (let i = 0; i < mapped.length && pending.length < COVER_FALLBACK_BUDGET; i++) {
          pending.push({ index: i, id: String(real[i]?.base_info?.id || ""), ownerId: String(real[i]?.base_info?.owner_id || "") });
        }
        await Promise.all(pending.map(async (entry) => {
          applyCoverFallback(mapped[entry.index], await firstTrack(entry.id, entry.ownerId));
        }));
        const items = [...virtual, ...mapped];
        return {
          provider: "qishui",
          playlists: items.slice(offset, offset + limit),
          total: items.length,
          nextOffset: offset + Math.min(limit, Math.max(0, items.length - offset)),
          hasMore: offset + limit < items.length,
          libraryErrors: liked ? [] : ["liked-playlist: not found"]
        };
      },
      async playlistTracks(id, limit, offset, ownerId = "") {
        const key = text2(id);
        if (key === QISHUI_FEED_ID || key === "qishui-feed") {
          const page2 = await feed.songs({ count: Math.max(limit, 6) });
          const songs = toFoliaSongs(page2.items);
          return {
            provider: "qishui",
            tracks: songs,
            songs,
            total: songs.length,
            offset,
            nextOffset: offset + songs.length,
            hasMore: Boolean(page2.hasMore)
          };
        }
        if (key === QISHUI_LIKED_ID || key === "qishui-liked") {
          const liked = await resolveLiked();
          if (!liked) {
            return {
              provider: "qishui",
              tracks: [],
              songs: [],
              total: 0,
              offset,
              nextOffset: offset,
              hasMore: false,
              libraryErrors: ["liked-playlist: not found"]
            };
          }
          return this.playlistTracks(liked.id, limit, offset, liked.ownerId);
        }
        const page = await catalog.playlistTracks({ id: key, ownerId, limit, offset });
        const tracks = toFoliaSongs(page.items);
        const card = page.collection ? toFoliaPlaylists([page.collection])[0] || null : null;
        applyCoverFallback(card, tracks[0] ? { cover: tracks[0].cover, name: tracks[0].name, artist: tracks[0].artist } : null);
        return {
          provider: "qishui",
          tracks,
          songs: tracks,
          playlist: card,
          total: tracks.length,
          offset,
          nextOffset: page.nextOffset,
          hasMore: page.hasMore
        };
      },
      async artist(artistId, limit, offset) {
        const page = await catalog.artistSongs({ id: artistId, limit: limit || 50, offset: offset || 0 });
        const songs = toFoliaSongs(page.items);
        let artist = null;
        try {
          const info = await catalog.artistDetail({ id: artistId });
          if (info) {
            artist = {
              id: text2(info.id || artistId),
              name: text2(info.name),
              cover: coverFromUrlInfo(info.url_avatar || info.avatar),
              trackCount: Number(info.count_tracks || songs.length) || 0,
              artists: [{ id: text2(info.id || artistId), name: text2(info.name) }]
            };
          }
        } catch (_) {
        }
        return { provider: "qishui", artist, songs, total: page.total, nextOffset: page.nextOffset, hasMore: page.hasMore };
      },
      async feed(limit) {
        const page = await feed.songs({ count: Math.max(limit, 6) });
        const songs = toFoliaSongs(page.items);
        return { provider: "qishui", songs, hasMore: Boolean(page.hasMore) };
      },
      feedModes: () => feed.modes(),
      likedSongs: () => library.likedSongs(),
      recentPlayed: (limit, offset) => library.recentPlayed({ limit, offset }).then((page) => ({
        provider: "qishui",
        songs: toFoliaSongs(page.items),
        hasMore: page.hasMore
      })),
      checkTracks: (ids) => library.checkTracks({ ids }),
      likeSong: (id, liked) => library.likeSong({ id, liked }).then(() => ({ provider: "qishui", success: true })),
      addSongs: (playlistId, ids) => library.editPlaylist({ operation: "add", id: playlistId, ids }).then(() => ({ provider: "qishui", success: true })),
      removeSongs: (playlistId, ids) => library.editPlaylist({ operation: "remove", id: playlistId, ids }).then(() => ({ provider: "qishui", success: true })),
      dislikeSong: (id, disliked) => library.dislikeSong({ id, disliked }).then(() => ({ provider: "qishui", success: true }))
    };
  }

  // src/entry.js
  var car = createQishuiCar({ log: (message) => console.info(message) });
  function qishuiErrorCode(value) {
    return String(value == null ? "" : value).trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function qishuiClampInt(value, fallback, min, max) {
    const raw = value === void 0 || value === null || value === "" ? String(fallback) : String(value);
    const parsed = parseInt(raw, 10) || fallback;
    return Math.max(min, Math.min(max, parsed));
  }
  function failureEnvelope(code, message) {
    return {
      ok: false,
      error: {
        code: qishuiErrorCode(code) || "qishui-error",
        message: String(message || code || "Qishui request failed")
      }
    };
  }
  function envelopeFromCarError(error, operation) {
    const code = error && error.code ? qishuiErrorCode(error.code) : "";
    const stage = error && error.stage ? ` (${error.stage})` : "";
    const upstream = error && error.upstreamCode ? ` [${error.upstreamCode}]` : "";
    const message = String(error && error.message || `Qishui ${operation} failed`) + stage + upstream;
    if (code === "auth-required") return failureEnvelope("login-required", message);
    if (code === "network") return failureEnvelope("network", message);
    if (code === "not-playable" || code === "unsupported") return failureEnvelope(code, message);
    return failureEnvelope(code || "qishui-error", message);
  }
  var handlers = {
    status: () => car.status(),
    "login.qr": async () => {
      const result = await car.startLogin();
      return {
        provider: "qishui",
        token: result.key,
        qrcode: result.qrDataUrl,
        qrDataUrl: result.qrDataUrl,
        expireTime: 300,
        message: "请使用抖音/汽水音乐 App 扫码并确认授权"
      };
    },
    "login.check": async (params) => {
      const token = String(params && params.token || "").trim();
      if (!token) {
        const keys = Object.keys(params && typeof params === "object" ? params : {}).join(",") || "(empty)";
        throw Object.assign(new Error("二维码登录 token 缺失（params keys: " + keys + "）"), { code: "missing-token" });
      }
      const result = await car.checkLogin(token);
      if (result.state === "error" && result.failure?.case === "refused") {
        return { provider: "qishui", status: "error", errorCode: 0, message: "授权被拒绝，请重试" };
      }
      const statusMap = { waiting: "waiting", scanned: "scanned", confirmed: "confirmed", expired: "expired" };
      const status = statusMap[result.state] || "waiting";
      if (result.state === "confirmed") {
        const statusData = await car.status();
        return Object.assign({}, statusData, {
          provider: "qishui",
          ok: true,
          status: "confirmed",
          errorCode: 0,
          error_code: 0,
          message: "登录成功"
        });
      }
      return {
        provider: "qishui",
        loggedIn: false,
        status,
        errorCode: 0,
        error_code: 0,
        retryAfterMs: 0,
        message: status === "expired" ? "二维码已过期，请重新生成" : ""
      };
    },
    "login.logout": () => car.logout(),
    search: (params) => {
      const p = params || {};
      const keywords = String(p.keywords || p.query || "");
      const limit = qishuiClampInt(p.limit, 12, 4, 20);
      const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      return car.search(keywords, limit, offset);
    },
    // 车机没有专辑端点；专辑入口在这里明确拒绝（上层把它显示为「暂不支持」，
    // 比静默空列表诚实）。单曲详情可以回，专辑聚合不行。
    album: () => {
      throw Object.assign(new Error("汽水车机协议没有专辑接口"), { code: "unsupported" });
    },
    "song.detail": (params) => car.songDetail(String(params && params.id || "")),
    lyric: (params) => car.lyrics(String(params && params.id || "")),
    "song.url": async (params) => {
      const p = params || {};
      return car.audio(String(p.id || ""), String(p.quality || "standard"));
    },
    artist: (params) => {
      const p = params || {};
      const artistId = String(p.artistId || "");
      if (!artistId) {
        throw Object.assign(new Error("汽水音乐需要艺人 ID"), { code: "missing-artist-id" });
      }
      const limit = qishuiClampInt(p.limit, 36, 10, 50);
      return car.artist(artistId, limit, 0);
    },
    feed: (params) => car.feed(qishuiClampInt((params || {}).limit, 8, 4, 12)),
    "user.playlists": () => car.userPlaylists(500, 0),
    "playlist.tracks": (params) => {
      const p = params || {};
      const id = String(p.id || "") || QISHUI_FEED_ID;
      const limit = qishuiClampInt(p.limit, 50, 1, Number.MAX_SAFE_INTEGER);
      const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      return car.playlistTracks(id, limit, offset);
    },
    "track.liked": async (params) => {
      const raw = Array.isArray((params || {}).ids) ? params.ids.join(",") : String((params || {}).ids || "");
      const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
      const result = await car.checkTracks(ids);
      return {
        provider: "qishui",
        statuses: result.statuses
      };
    },
    "track.like": async (params) => {
      const p = params || {};
      const liked = String(p.liked != null ? p.liked : "true") !== "false";
      return car.likeSong(String(p.id || ""), liked);
    },
    "playlist.collect": () => {
      throw Object.assign(new Error("汽水车机协议不支持收藏歌单"), { code: "unsupported" });
    },
    "playlist.addSong": async (params) => {
      const p = params || {};
      return car.addSongs(String(p.playlistId || ""), [String(p.trackId || "")].filter(Boolean));
    },
    "album.collect": () => {
      throw Object.assign(new Error("汽水车机协议不支持收藏专辑"), { code: "unsupported" });
    },
    "report.play": () => ({ provider: "qishui", success: true, note: "car protocol has no play report endpoint" }),
    comments: () => {
      throw Object.assign(new Error("汽水车机协议没有评论接口"), { code: "unsupported" });
    },
    "comment.create": () => {
      throw Object.assign(new Error("汽水车机协议没有评论接口"), { code: "unsupported" });
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
  async function request(operation, params) {
    const name = String(operation || "");
    if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
      return failureEnvelope("unsupported", "Unsupported qishui operation: " + name);
    }
    try {
      const data = await handlers[name](params && typeof params === "object" ? params : {});
      return { ok: true, data };
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[FoliaQishui] " + name + " failed:", error && error.message || error);
      }
      return envelopeFromCarError(error, name);
    }
  }
  window.__foliaQishui = {
    async start(operation, params, ticket) {
      const envelope = await request(operation, normalizeParams(params));
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
  window.__foliaSetMfaVisible = function() {
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
