import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger, type Logger } from "./logger";

describe("createLogger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function allStdout(): string {
    return stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
  }

  function allStderr(): string {
    return stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
  }

  // ── Default mode (verbose=false, json=false) ─────────────────────────

  describe("default mode", () => {
    it("info() writes to stdout with newline", () => {
      const log = createLogger({ verbose: false, json: false });
      log.info("hello world");
      expect(allStdout()).toBe("hello world\n");
    });

    it("debug() is suppressed in default mode", () => {
      const log = createLogger({ verbose: false, json: false });
      log.debug("this should not appear");
      expect(allStdout()).toBe("");
      expect(allStderr()).toBe("");
    });

    it("warn() writes to stderr", () => {
      const log = createLogger({ verbose: false, json: false });
      log.warn("warning!");
      expect(allStderr()).toBe("warning!\n");
    });

    it("error() writes to stderr", () => {
      const log = createLogger({ verbose: false, json: false });
      log.error("something broke");
      expect(allStderr()).toBe("something broke\n");
    });
  });

  // ── Verbose mode ─────────────────────────────────────────────────────

  describe("verbose mode", () => {
    it("info() writes to stdout", () => {
      const log = createLogger({ verbose: true, json: false });
      log.info("visible");
      expect(allStdout()).toBe("visible\n");
    });

    it("debug() writes to stderr when verbose=true", () => {
      const log = createLogger({ verbose: true, json: false });
      log.debug("debug info");
      expect(allStderr()).toContain("debug info");
    });

    it("warn() writes to stderr", () => {
      const log = createLogger({ verbose: true, json: false });
      log.warn("watch out");
      expect(allStderr()).toContain("watch out");
    });

    it("error() writes to stderr", () => {
      const log = createLogger({ verbose: true, json: false });
      log.error("failed");
      expect(allStderr()).toContain("failed");
    });
  });

  // ── JSON mode ────────────────────────────────────────────────────────

  describe("json mode", () => {
    it("info() is suppressed in JSON mode", () => {
      const log = createLogger({ verbose: false, json: true });
      log.info("should not appear");
      expect(allStdout()).toBe("");
    });

    it("debug() is suppressed in JSON mode", () => {
      const log = createLogger({ verbose: false, json: true });
      log.debug("should not appear");
      expect(allStdout()).toBe("");
      expect(allStderr()).toBe("");
    });

    it("warn() still writes to stderr in JSON mode", () => {
      const log = createLogger({ verbose: false, json: true });
      log.warn("json warning");
      expect(allStderr()).toContain("json warning");
    });

    it("error() still writes to stderr in JSON mode", () => {
      const log = createLogger({ verbose: false, json: true });
      log.error("json error");
      expect(allStderr()).toContain("json error");
    });
  });

  // ── Timing ───────────────────────────────────────────────────────────

  describe("timing", () => {
    it("time() and timeEnd() return elapsed milliseconds", () => {
      const log = createLogger({ verbose: false, json: false });
      log.time("op");
      // timeEnd should return a positive number
      const elapsed = log.timeEnd("op");
      expect(typeof elapsed).toBe("number");
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it("timeEnd() returns 0 for unknown labels", () => {
      const log = createLogger({ verbose: false, json: false });
      const elapsed = log.timeEnd("never-started");
      expect(elapsed).toBe(0);
    });

    it("getTimings() returns all recorded timings", () => {
      const log = createLogger({ verbose: false, json: false });
      log.time("a");
      log.timeEnd("a");
      log.time("b");
      log.timeEnd("b");

      const timings = log.getTimings();
      expect(timings).toHaveProperty("a");
      expect(timings).toHaveProperty("b");
      expect(typeof timings.a).toBe("number");
      expect(typeof timings.b).toBe("number");
    });

    it("getTimings() does not include incomplete timers", () => {
      const log = createLogger({ verbose: false, json: false });
      log.time("started-only");
      const timings = log.getTimings();
      expect(timings).not.toHaveProperty("started-only");
    });

    it("timeEnd() logs to stderr in verbose mode", () => {
      const log = createLogger({ verbose: true, json: false });
      log.time("fetch");
      log.timeEnd("fetch");
      expect(allStderr()).toContain("fetch");
      expect(allStderr()).toContain("ms");
    });

    it("timeEnd() does not log in default mode", () => {
      const log = createLogger({ verbose: false, json: false });
      log.time("fetch");
      log.timeEnd("fetch");
      expect(allStderr()).toBe("");
    });
  });
});
