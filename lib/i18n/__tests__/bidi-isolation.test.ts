import {
  containsBidiControlCharacters,
  isolationWrap,
  makeBidiSafeForDisplay,
  stripBidiControlCharacters,
} from "../bidi-isolation";

const STELLAR_ADDRESS = "GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW";
const RLO = "‮";
const LRO = "‭";
const RLM = "‏";
const LRM = "‎";
const FSI = "⁨";
const PDI = "⁩";

describe("containsBidiControlCharacters", () => {
  it("detects RLO (the classic spoofing character)", () => {
    expect(containsBidiControlCharacters(`GA7Q${RLO}XYZ1234`)).toBe(true);
  });

  it("detects LRO, RLM, LRM, and the isolate controls", () => {
    expect(containsBidiControlCharacters(`a${LRO}b`)).toBe(true);
    expect(containsBidiControlCharacters(`a${RLM}b`)).toBe(true);
    expect(containsBidiControlCharacters(`a${LRM}b`)).toBe(true);
    expect(containsBidiControlCharacters(`a${FSI}b${PDI}c`)).toBe(true);
  });

  it("returns false for an ordinary identifier with no control characters", () => {
    expect(containsBidiControlCharacters(STELLAR_ADDRESS)).toBe(false);
  });

  it("returns false for ordinary mixed-script text (RTL letters are not control characters)", () => {
    // Arabic/Hebrew letters themselves are not bidi CONTROL characters —
    // only the explicit formatting codes are. A hash embedded in Arabic
    // prose should not be flagged just for appearing next to RTL text.
    expect(containsBidiControlCharacters("مرحبا GA7QYNF7 بالعالم")).toBe(false);
  });
});

describe("stripBidiControlCharacters", () => {
  it("removes an embedded RLO without altering the surrounding characters", () => {
    const withRlo = `GA7Q${RLO}YNF7SOWQ`;
    const stripped = stripBidiControlCharacters(withRlo);
    expect(stripped).toBe("GA7QYNF7SOWQ");
    expect(containsBidiControlCharacters(stripped)).toBe(false);
  });

  it("removes multiple different control characters in one pass", () => {
    const poisoned = `${LRO}GA${RLO}7Q${RLM}YNF7${LRM}SOWQ${PDI}`;
    expect(stripBidiControlCharacters(poisoned)).toBe("GA7QYNF7SOWQ");
  });

  it("leaves an ordinary identifier completely unchanged", () => {
    expect(stripBidiControlCharacters(STELLAR_ADDRESS)).toBe(STELLAR_ADDRESS);
  });

  it("leaves mixed-script text (RTL letters) unchanged", () => {
    const mixed = "مرحبا GA7QYNF7 بالعالم";
    expect(stripBidiControlCharacters(mixed)).toBe(mixed);
  });

  it("does not alter the byte length in a way that would change a hash's meaning if later re-parsed", () => {
    // Stripping removes characters (shortens the string) — this test
    // documents that stripping is lossy for control characters
    // specifically, which is the intended security behavior: a
    // malicious RLO is deliberately removed, not preserved and hidden.
    const withRlo = `${STELLAR_ADDRESS.slice(0, 10)}${RLO}${STELLAR_ADDRESS.slice(10)}`;
    expect(stripBidiControlCharacters(withRlo)).toBe(STELLAR_ADDRESS);
  });
});

describe("isolationWrap", () => {
  it("wraps the value in FSI/PDI isolate marks", () => {
    const wrapped = isolationWrap(STELLAR_ADDRESS);
    expect(wrapped.startsWith(FSI)).toBe(true);
    expect(wrapped.endsWith(PDI)).toBe(true);
  });

  it("the wrapped value, with isolate marks removed, equals the original", () => {
    const wrapped = isolationWrap(STELLAR_ADDRESS);
    const unwrapped = wrapped.slice(FSI.length, -PDI.length);
    expect(unwrapped).toBe(STELLAR_ADDRESS);
  });
});

describe("makeBidiSafeForDisplay", () => {
  it("flags hadBidiControlCharacters for a poisoned value", () => {
    const result = makeBidiSafeForDisplay(`GA7Q${RLO}YNF7`);
    expect(result.hadBidiControlCharacters).toBe(true);
  });

  it("does not flag an ordinary value", () => {
    const result = makeBidiSafeForDisplay(STELLAR_ADDRESS);
    expect(result.hadBidiControlCharacters).toBe(false);
  });

  it("the display value has control characters stripped and is isolate-wrapped", () => {
    const result = makeBidiSafeForDisplay(`GA7Q${RLO}YNF7`);
    expect(result.displayValue).toBe(`${FSI}GA7QYNF7${PDI}`);
    expect(containsBidiControlCharacters(result.displayValue.slice(FSI.length, -PDI.length))).toBe(
      false,
    );
  });

  it("works correctly for mixed-script (RTL + LTR) input", () => {
    const mixed = "מזהה: GA7QYNF7SOWQ";
    const result = makeBidiSafeForDisplay(mixed);
    expect(result.hadBidiControlCharacters).toBe(false);
    expect(result.displayValue).toContain("GA7QYNF7SOWQ");
  });
});

describe("visual order cannot spoof prefixes or suffixes (end-to-end)", () => {
  it("an RLO placed to visually swap an identifier's apparent prefix/suffix is neutralized", () => {
    // Simulates the classic spoofing pattern: RLO placed so a renderer
    // would show the trailing characters first, potentially disguising
    // what looks like the "start" of the address.
    const spoofAttempt = `${RLO}WXBFM5D5DFGAYVY7ADGDGDC5DWHVGVAVAXHEZMGB2R3QWOS7FNYQ7AG`;
    const result = makeBidiSafeForDisplay(spoofAttempt);
    // The only bidi-related characters left in the display value are the
    // FSI/PDI isolate marks this module itself deliberately adds around
    // the (now-stripped) identifier, not the attacker's RLO — unwrapping
    // those marks shows the RLO is gone from the actual content.
    const innerContent = result.displayValue.slice(1, -1);
    expect(containsBidiControlCharacters(innerContent)).toBe(false);
    expect(result.hadBidiControlCharacters).toBe(true);
  });
});
