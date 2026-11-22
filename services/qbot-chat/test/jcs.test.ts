import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { jcs, jcsSha256 } from "../src/card-import/jcs.ts";

describe("RFC 8785", () => {
  it("matches the section 3.2.4 canonical UTF-8 bytes", () => {
    const sample = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/rfc8785-sample.json", import.meta.url)), "utf8"));
    const expected = [
      "7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c",
      "226e756d62657273223a5b3333333333333333332e333333333333332c",
      "31652b33302c342e352c302e3030322c31652d32375d2c22737472696e",
      "67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d",
    ].join("");
    assert.equal(Buffer.from(jcs(sample), "utf8").toString("hex"), expected);
  });

  it("sorts object keys by UTF-16 code units", () => {
    const canonical = jcs({
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    });
    const values = [...canonical.matchAll(/:"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string);
    assert.deepEqual(values, [
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ]);
  });

  it("serializes the appendix B number samples", () => {
    const samples: Array<[string, string]> = [
      ["0000000000000000", "0"],
      ["8000000000000000", "0"],
      ["0000000000000001", "5e-324"],
      ["8000000000000001", "-5e-324"],
      ["7fefffffffffffff", "1.7976931348623157e+308"],
      ["ffefffffffffffff", "-1.7976931348623157e+308"],
      ["4340000000000000", "9007199254740992"],
      ["c340000000000000", "-9007199254740992"],
      ["4430000000000000", "295147905179352830000"],
      ["44b52d02c7e14af5", "9.999999999999997e+22"],
      ["44b52d02c7e14af6", "1e+23"],
      ["44b52d02c7e14af7", "1.0000000000000001e+23"],
      ["444b1ae4d6e2ef4e", "999999999999999700000"],
      ["444b1ae4d6e2ef4f", "999999999999999900000"],
      ["444b1ae4d6e2ef50", "1e+21"],
      ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
      ["3eb0c6f7a0b5ed8d", "0.000001"],
      ["41b3de4355555553", "333333333.3333332"],
      ["41b3de4355555554", "333333333.33333325"],
      ["41b3de4355555555", "333333333.3333333"],
      ["41b3de4355555556", "333333333.3333334"],
      ["41b3de4355555557", "333333333.33333343"],
      ["becbf647612f3696", "-0.0000033333333333333333"],
      ["43143ff3c1cb0959", "1424953923781206.2"],
    ];
    for (const [hex, json] of samples) {
      const value = Buffer.from(hex, "hex").readDoubleBE(0);
      assert.equal(jcs(value), json, hex);
    }
  });

  it("rejects NaN and Infinity", () => {
    assert.throws(() => jcs(Number.NaN));
    assert.throws(() => jcs(Number.POSITIVE_INFINITY));
    assert.equal(jcsSha256({ ok: true }).length, 64);
  });
});
