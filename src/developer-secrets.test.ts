import { describe, expect, test } from "bun:test";
import { shield, unshield } from "./index";

describe("Lokale Entwicklergeheimnisse", () => {
  test("Datenbank-URLs mit Zugangsdaten verschwinden vollständig und bleiben reversibel", () => {
    for (const protocol of ["postgres", "postgresql", "mysql", "mongodb+srv", "redis", "rediss", "amqp", "amqps"]) {
      const source = `${protocol}://test-user:test-pass@db.example.invalid:5432/main?ssl=true`;
      const result = shield(source);
      expect(result.counts.DATABASE_URL).toBe(1);
      expect(result.masked).toBe("[DATABASE_URL_1]");
      expect(unshield(result.masked, result.map)).toBe(source);
    }
  });
  test("Datenbank-URL ohne eingebettetes Passwort bleibt unverändert", () => {
    const source = "postgres://db.example.invalid/main";
    expect(shield(source).masked).toBe(source);
  });
  test("env-Passwörter, Tokens und Secrets erhalten Bezeichner und Zeilenstruktur", () => {
    const source = 'DB_PASSWORD="fictional-pass"\nAWS_SECRET_ACCESS_KEY=fictional-access\nexport API_KEY=fictional-key\nCLIENT_SECRET=fictional-secret\nPORT=8080';
    const result = shield(source);
    expect(result.masked).not.toContain("fictional-");
    expect(result.masked).toContain("DB_PASSWORD=");
    expect(result.masked).toContain("PORT=8080");
    expect(unshield(result.masked, result.map)).toBe(source);
    expect(result.counts.SECRET).toBe(4);
  });
  test("Bearer-Werte werden ohne Rückgabe des Werts erkannt", () => {
    const source = "Authorization: Bearer fictional-token.12345678";
    const result = shield(source);
    expect(result.masked).toBe("Authorization: Bearer [SECRET_1]");
    expect(unshield(result.masked, result.map)).toBe(source);
  });
  test("Umgebungsreferenzen und vorhandene Platzhalter bleiben erhalten", () => {
    const source = 'DB_PASSWORD=${DB_PASS}\nAPI_KEY=$MY_KEY\nAPI_KEY=[API_KEY_1]\nPORT=8080';
    expect(shield(source).masked).toBe(source);
  });
  test("vorhandene Provider-Muster funktionieren auch ohne env-Bezeichner", () => {
    const keys = ["sk-proj-" + "a".repeat(24), "sk-ant-api03-" + "b".repeat(24), "AKIA" + "A".repeat(16), "ghp_" + "c".repeat(36)];
    const source = keys.join(" ");
    const result = shield(source);
    expect(result.counts.API_KEY).toBe(4);
    for (const key of keys) expect(result.masked).not.toContain(key);
    expect(unshield(result.masked, result.map)).toBe(source);
  });
});