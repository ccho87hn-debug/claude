// Online rooms over WebRTC (PeerJS). The host's game is the real one: it simulates the round and
// streams it to guests, who only send their bets. PeerJS's free cloud server is used just to
// introduce the computers to each other; game traffic goes directly between them.
(function () {
  const { makeRoomCode } = window.RPS;
  const PREFIX = "rps-battle-v1-";

  // For local testing a different PeerJS server can be set, e.g. localStorage "rpsBattle.peerServer" = "localhost:9000".
  function peerOptions() {
    let custom = null;
    try { custom = localStorage.getItem("rpsBattle.peerServer"); } catch {}
    if (!custom) return { debug: 0 };
    const [host, port] = custom.split(":");
    return { host, port: +port || 9000, path: "/", secure: false, debug: 0 };
  }

  const ERRORS = {
    "peer-unavailable": "그 코드의 방을 찾을 수 없어요.",
    network: "인터넷 연결을 확인해 주세요.",
    "server-error": "연결 서버에 접속하지 못했어요. 잠시 후 다시 해 보세요.",
    "socket-error": "연결 서버에 접속하지 못했어요. 잠시 후 다시 해 보세요.",
    "browser-incompatible": "이 컴퓨터에서는 온라인 모드를 쓸 수 없어요.",
  };
  // Closing a laptop lid or losing Wi-Fi doesn't always close the connection, so both sides ping
  // and treat a peer that has been silent for a while as gone.
  const PING_EVERY = 2000;
  const DEAD_AFTER = 8000;

  const message = (err) => ERRORS[err && err.type] || "연결에 문제가 생겼어요.";

  class Room {
    constructor(peer, role, code, handlers) {
      this.peer = peer;
      this.role = role;
      this.code = code;
      this.h = handlers;
      this.conns = new Map(); // host: guest peer id -> connection; guest: "host" -> connection
      this.seen = new Map(); // peer id -> last time we heard from it
      this.closed = false;
      this.pinger = setInterval(() => this._ping(), PING_EVERY);
    }

    _ping() {
      const now = Date.now();
      for (const [id, conn] of this.conns) {
        if (now - (this.seen.get(id) || now) > DEAD_AFTER) this._lost(id);
        else if (conn.open) conn.send({ t: "ping" });
      }
    }

    // Opens a room under a fresh code (retrying if the code is taken).
    static host(handlers, tries = 5) {
      return new Promise((resolve, reject) => {
        const code = makeRoomCode();
        const peer = new Peer(PREFIX + code, peerOptions());
        const room = new Room(peer, "host", code, handlers);
        let opened = false;
        peer.on("open", () => { opened = true; resolve(room); });
        peer.on("connection", (conn) => room._adopt(conn.peer, conn));
        peer.on("disconnected", () => { if (!room.closed) peer.reconnect(); });
        peer.on("error", (err) => {
          if (opened) return;
          peer.destroy();
          if (err.type === "unavailable-id" && tries > 1) Room.host(handlers, tries - 1).then(resolve, reject);
          else reject(new Error(message(err)));
        });
      });
    }

    static join(code, handlers) {
      return new Promise((resolve, reject) => {
        const peer = new Peer(peerOptions());
        const room = new Room(peer, "guest", code, handlers);
        let opened = false;
        const fail = (err) => {
          if (opened) return;
          opened = true;
          peer.destroy();
          reject(new Error(message(err)));
        };
        const timer = setTimeout(() => fail({ type: "peer-unavailable" }), 15000);
        peer.on("error", (err) => { clearTimeout(timer); fail(err); });
        peer.on("open", () => {
          const conn = peer.connect(PREFIX + code, { reliable: true });
          conn.on("open", () => {
            clearTimeout(timer);
            opened = true;
            room._adopt("host", conn);
            resolve(room);
          });
        });
      });
    }

    _adopt(id, conn) {
      const setup = () => {
        this.conns.set(id, conn);
        this.seen.set(id, Date.now());
        conn.on("data", (msg) => {
          this.seen.set(id, Date.now());
          if (this.closed || !msg || typeof msg !== "object" || msg.t === "ping") return;
          this.h.onMessage(id, msg);
        });
        conn.on("close", () => this._lost(id));
        conn.on("error", () => this._lost(id));
        if (this.role === "host") this.h.onJoin && this.h.onJoin(id);
      };
      if (conn.open) setup();
      else conn.on("open", setup);
    }

    _lost(id) {
      const conn = this.conns.get(id);
      if (!this.conns.delete(id) || this.closed) return;
      this.seen.delete(id);
      try { conn.close(); } catch {}
      if (this.role === "guest") {
        this.close();
        this.h.onClosed && this.h.onClosed();
      } else {
        this.h.onLeave && this.h.onLeave(id);
      }
    }

    // Host: to every guest. Guest: to the host.
    send(msg) {
      for (const conn of this.conns.values()) if (conn.open) conn.send(msg);
    }

    sendTo(id, msg) {
      const conn = this.conns.get(id);
      if (conn && conn.open) conn.send(msg);
    }

    kick(id) {
      const conn = this.conns.get(id);
      this.conns.delete(id);
      this.seen.delete(id);
      if (conn) conn.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.pinger);
      for (const conn of this.conns.values()) conn.close();
      this.conns.clear();
      this.peer.destroy();
    }
  }

  window.Net = { Room };
})();
