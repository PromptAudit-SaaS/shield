import { describe, expect, test } from "bun:test";
import { shield, unshield, withShield } from "./index";

describe("shield", () => {
  test("masks valid IBAN, card, SSN, routing, email, phone, name", () => {
    const t = "Mr. John Miller, john@acme.com, +41 79 123 45 67, IBAN CH93 0076 2011 6238 5295 7, card 4111 1111 1111 1111, SSN 123-45-6789, routing 021000021";
    const r = shield(t);
    for (const v of ["John Miller", "john@acme.com", "CH93", "4111", "123-45-6789", "021000021", "79 123"]) expect(r.masked).not.toContain(v);
    expect(r.counts).toEqual({ EMAIL: 1, IBAN: 1, CREDIT_CARD: 1, US_SSN: 1, ROUTING: 1, PHONE: 1, NAME: 1 });
  });
  test("leaves checksum-invalid numbers alone", () => {
    expect(shield("order 4111 1111 1111 1112 and CH94 0076 2011 6238 5295 7").masked).toContain("4111 1111 1111 1112");
    expect(shield("CH94 0076 2011 6238 5295 7").counts.IBAN).toBeUndefined();
    expect(shield("SSN 666-45-6789").masked).toContain("666-45-6789");
  });
  test("catches zero-width and full-width obfuscation", () => {
    expect(shield("CH93\u200B0076201162385295 7").counts.IBAN).toBe(1);
    expect(shield("４１１１１１１１１１１１１１１１").counts.CREDIT_CARD).toBe(1);
  });
  test("round trip and same value reuses placeholder", async () => {
    const r = shield("a@b.ch then a@b.ch");
    expect(r.masked).toBe("[EMAIL_1] then [EMAIL_1]");
    expect(unshield("Reply to [EMAIL_1]", r.map)).toBe("Reply to a@b.ch");
    const out = await withShield("mail a@b.ch", async (p) => { expect(p).not.toContain("a@b.ch"); return `ok ${p}`; });
    expect(out).toBe("ok mail a@b.ch");
  });
  test("company names without title stay", () => {
    expect(shield("Visit the Apple Store").masked).toBe("Visit the Apple Store");
  });
  test("masks API keys and private keys", () => {
    const aws = "AKIA" + "IOSFODNN7EXAMPLE";
    const gh = "ghp_" + "a".repeat(36);
    const oa = "sk-proj-" + "Ab3_".repeat(8);
    const sl = "xoxb-" + "1234567890-abcdefABCDEF";
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const pk = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----";
    const r = shield(`k ${aws} ${gh} ${oa} ${sl} ${jwt}\n${pk}`);
    expect(r.counts.API_KEY).toBe(5);
    expect(r.counts.PRIVATE_KEY).toBe(1);
    for (const v of [aws, gh, oa, sl, jwt, "MIIBOgIBAAJBAK"]) expect(r.masked).not.toContain(v);
    expect(unshield(r.masked, r.map)).toBe(`k ${aws} ${gh} ${oa} ${sl} ${jwt}\n${pk}`);
  });
  test("plain hashes and words stay", () => {
    const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(shield(`sha ${sha} sk-short task-list`).masked).toBe(`sha ${sha} sk-short task-list`);
  });
});
