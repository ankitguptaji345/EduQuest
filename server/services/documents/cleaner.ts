import type { ExtractedUnit } from './extractors.ts';

export interface PracticalComparisonTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface PracticalSubtopic {
  title: string;
  theory: string | null;
  code: string | null;
  sample_output: string | null;
  source_ref: string;
}

export interface PracticalExperiment {
  number: number;
  title: string;
  source_ref: string;
  aim: string | null;
  theory: string | null;
  subtopics: PracticalSubtopic[];
  comparisons: PracticalComparisonTable[];
  key_points: string[];
  result: string | null;
}

export interface TheorySection {
  title: string;
  source_ref: string;
  introduction: string | null;
  definitions: string[];
  explanation: string[];
  key_concepts: string[];
  formulas: string[];
  examples: string[];
  comparisons: string[];
  quick_revision: string[];
  important_questions: string[];
}

export interface CommandRefItem {
  command: string;
  purpose: string;
  source_ref: string;
}

export interface StructuredStudyNotes {
  kind: 'practical' | 'theory';
  overview: string;
  unsuitable_reason: string | null;
  general_instructions: string[];
  practical_experiments: PracticalExperiment[];
  commands_reference: CommandRefItem[];
  viva_questions: string[];
  theory_sections: TheorySection[];
}

const ADMIN_FIELD_REGEX =
  /\b(name of student|student name|roll\s*no\.?|enrollment\s*no\.?|reg(?:istration)?\s*no\.?|academic\s*session|submitted\s*(?:by|to)|faculty\s*signature|signature\s*of|guide\s*name|internal\s*examiner|external\s*examiner)\b/i;

const ADMIN_LABEL_BLANK_REGEX =
  /^(?:semester|department|institution|institute|college|university|school|branch|section|batch|subject\s*code|course\s*code|date|name|roll\s*no\.?)\s*[:\-–]?\s*(?:[_.\-–\s]*)$/i;

const UNDERSCORE_FILL_REGEX = /_{3,}/;

const COVER_METADATA_REGEX =
  /^(?:complete\s+practical\s+record|practical\s+record|lab\s+manual|laboratory\s+manual|it\s+workshop\s*\([^)]+\)\s*laboratory|certificate|bonafide\s+certificate|acknowledg(?:e)?ment|index|table\s+of\s+contents)\b|^[A-Z]{2,6}[-\s]?\d{2,4}\s*\|/i;

const STANDALONE_COURSE_CODE_REGEX = /^[A-Z]{2,6}[-\s]?\d{2,4}$/;
const PAGE_NUMBER_LINE_REGEX = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*\/\s*\d+|-\s*\d+\s*-)$/i;

export function isAdminOrNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (UNDERSCORE_FILL_REGEX.test(trimmed)) return true;
  if (ADMIN_FIELD_REGEX.test(trimmed)) return true;
  if (ADMIN_LABEL_BLANK_REGEX.test(trimmed)) return true;
  if (PAGE_NUMBER_LINE_REGEX.test(trimmed)) return true;
  if (STANDALONE_COURSE_CODE_REGEX.test(trimmed)) return true;
  if (/^[_\-–.=*\s]{3,}$/.test(trimmed)) return true;
  return false;
}

export function isAdminOrNoiseText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return true;
  if (UNDERSCORE_FILL_REGEX.test(trimmed)) return true;
  if (ADMIN_FIELD_REGEX.test(trimmed)) return true;
  if (ADMIN_LABEL_BLANK_REGEX.test(trimmed)) return true;
  if (COVER_METADATA_REGEX.test(trimmed) && trimmed.length < 120) return true;
  if (STANDALONE_COURSE_CODE_REGEX.test(trimmed)) return true;
  if (/^(?:semester|department|institution|roll\s*no|academic\s*session|name\s*of\s*student)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeHeaderCandidate(line: string): string {
  return line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\d+\b/g, '#')
    .toLowerCase();
}

export function detectRepeatedHeadersFooters(units: ExtractedUnit[]): Set<string> {
  const repeated = new Set<string>();
  if (units.length < 3) return repeated;

  const threshold = Math.max(2, Math.floor(units.length * 0.25));
  const counts = new Map<string, number>();

  for (const unit of units) {
    const lines = unit.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const candidates = new Set<string>();
    for (const l of lines.slice(0, 2)) {
      if (l.length >= 6 && l.length <= 120) candidates.add(normalizeHeaderCandidate(l));
    }
    for (const l of lines.slice(-2)) {
      if (l.length >= 6 && l.length <= 120) candidates.add(normalizeHeaderCandidate(l));
    }

    for (const c of candidates) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }

  for (const [key, cnt] of counts.entries()) {
    if (cnt >= threshold) {
      repeated.add(key);
    }
  }

  return repeated;
}

function isCoverPageLines(lines: string[]): boolean {
  if (lines.length === 0) return true;
  let adminOrMetaCount = 0;
  let educationalCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (
      isAdminOrNoiseLine(t) ||
      COVER_METADATA_REGEX.test(t) ||
      STANDALONE_COURSE_CODE_REGEX.test(t)
    ) {
      adminOrMetaCount += 1;
    } else if (
      t.length > 35 ||
      /\b(aim|theory|definition|algorithm|experiment\s+\d+|example|function|matrix|array|stack|queue)\b/i.test(t)
    ) {
      educationalCount += 1;
    }
  }

  return adminOrMetaCount >= 2 && educationalCount === 0;
}

export interface CleanedExtractionSummary {
  units: ExtractedUnit[];
  repeatedHeaders: Set<string>;
  removedCoverPages: number;
  unsuitableReason: string | null;
}

export function cleanExtractedUnits(units: ExtractedUnit[]): CleanedExtractionSummary {
  const repeatedHeaders = detectRepeatedHeadersFooters(units);
  const cleanedUnits: ExtractedUnit[] = [];
  let removedCoverPages = 0;

  for (const unit of units) {
    const rawLines = unit.text.split('\n').map((l) => l.trim());
    if (isCoverPageLines(rawLines)) {
      removedCoverPages += 1;
      continue;
    }

    const filteredLines: string[] = [];
    for (const line of rawLines) {
      if (!line) continue;
      if (repeatedHeaders.has(normalizeHeaderCandidate(line))) continue;
      if (isAdminOrNoiseLine(line)) continue;
      if (COVER_METADATA_REGEX.test(line) && line.length < 90) continue;
      filteredLines.push(line);
    }

    const joined = filteredLines.join('\n').trim();
    if (joined.length < 20) {
      removedCoverPages += 1;
      continue;
    }

    // Refine headingPath so it does not keep a noisy repeated header
    let headingPath = unit.headingPath || unit.label;
    if (repeatedHeaders.has(normalizeHeaderCandidate(headingPath)) || isAdminOrNoiseText(headingPath)) {
      headingPath = `${unit.kind === 'page' ? 'Page' : unit.kind === 'slide' ? 'Slide' : 'Section'} ${unit.number}`;
    }

    cleanedUnits.push({
      ...unit,
      headingPath,
      text: joined,
    });
  }

  let unsuitableReason: string | null = null;
  if (cleanedUnits.length === 0) {
    unsuitableReason =
      'This file appears to contain only administrative cover-page fields, blank forms, or non-educational metadata. Upload lecture notes, lab experiments, or textbook material to generate study notes and quizzes.';
  } else {
    const totalCleanChars = cleanedUnits.reduce((s, u) => s + u.text.length, 0);
    if (totalCleanChars < 45) {
      unsuitableReason =
        'Not enough meaningful educational content remained after filtering administrative headers and form fields.';
    }
  }

  return {
    units: cleanedUnits,
    repeatedHeaders,
    removedCoverPages,
    unsuitableReason,
  };
}

export function detectDocumentKind(text: string): 'practical' | 'theory' {
  const practicalScore =
    (/\bEXPERIMENT\s+\d+\b/i.test(text) ? 3 : 0) +
    (/\bAIM\s*:/i.test(text) ? 2 : 0) +
    (/\b(?:MATLAB|Scilab|Python|C\+\+|Java)\s+Program\s*:/i.test(text) ? 2 : 0) +
    (/\bSample\s+Output\s*:/i.test(text) ? 2 : 0) +
    (/\bRESULT\s*:/i.test(text) ? 1 : 0) +
    (/\bSUGGESTED\s+VIVA\s+QUESTIONS\b/i.test(text) ? 2 : 0) +
    (/\bIMPORTANT\s+[A-Z\s]+\s+COMMANDS\b/i.test(text) ? 2 : 0);

  return practicalScore >= 3 ? 'practical' : 'theory';
}

interface TaggedLine {
  text: string;
  pageLabel: string;
}

const EXPERIMENT_HEADING_RE = /^EXPERIMENT\s+(\d+)\s*[:\-–]\s*(.+)$/i;
const SUBTOPIC_HEADING_RE = /^(\d+\.\d+)\s+([A-Z][^\n]{2,90})$/;
const COMPARISON_HEADING_RE = /^(Difference\s+Between\s+.+)$/i;
const IMPORTANCE_HEADING_RE = /^(Importance\s+of\s+.+)$/i;
const VIVA_HEADING_RE = /^(SUGGESTED\s+VIVA\s+QUESTIONS|VIVA\s+QUESTIONS)$/i;
const COMMANDS_HEADING_RE = /^(IMPORTANT\s+[A-Z\s]*COMMANDS(?:\s*\/\s*OPERATORS)?)$/i;

function isControlLabel(line: string): boolean {
  return /^(?:AIM|Theory\s*\/\s*Introduction|Theory|MATLAB\s+Program|Program|Code|Sample\s+Output|RESULT|Function\s+Syntax|Optional\s+Extension|Sample\s+Assignment|GENERAL\s+INSTRUCTIONS)\s*:/i.test(
    line,
  );
}

function cleanBulletOrLine(line: string): string {
  return line.replace(/^[•*\-]\s*/, '').replace(/\s+/g, ' ').trim();
}

export function formatCodeSnippet(rawLines: string[]): string {
  const joined = rawLines.join('\n').trim();
  if (!joined) return '';
  // Split single-line semicolon-packed setup slightly where helpful while preserving strings/matrices
  return joined;
}

function parsePracticalStudyNotes(
  documentTitle: string,
  units: ExtractedUnit[],
): StructuredStudyNotes {
  const taggedLines: TaggedLine[] = [];
  for (const u of units) {
    const pageLabel =
      u.kind === 'page' ? `Page ${u.number}` : u.kind === 'slide' ? `Slide ${u.number}` : u.label;
    for (const line of u.text.split('\n')) {
      const t = line.trim();
      if (!t || isAdminOrNoiseLine(t)) continue;
      if (/^Note:\s*Outputs are sample outputs/i.test(t)) continue;
      taggedLines.push({ text: t, pageLabel });
    }
  }

  const generalInstructions: string[] = [];
  const experiments: PracticalExperiment[] = [];
  const vivaQuestions: string[] = [];
  const commandsReference: CommandRefItem[] = [];

  let mode:
    | 'top'
    | 'instructions'
    | 'exp_aim'
    | 'exp_theory'
    | 'sub_theory'
    | 'sub_code'
    | 'sub_output'
    | 'exp_result'
    | 'exp_comparison'
    | 'exp_importance'
    | 'viva'
    | 'commands' = 'top';

  let currentExp: PracticalExperiment | null = null;
  let currentSub: PracticalSubtopic | null = null;
  let currentComp: PracticalComparisonTable | null = null;
  let codeLines: string[] = [];
  let outputLines: string[] = [];
  let theoryLines: string[] = [];
  const seenInstructions = new Set<string>();
  const seenCommands = new Set<string>();

  const flushSubBuffers = () => {
    if (!currentSub) return;
    if (theoryLines.length > 0) {
      const text = theoryLines.join(' ').replace(/\s+/g, ' ').trim();
      currentSub.theory = currentSub.theory ? `${currentSub.theory} ${text}` : text;
      theoryLines = [];
    }
    if (codeLines.length > 0) {
      const code = formatCodeSnippet(codeLines);
      currentSub.code = currentSub.code ? `${currentSub.code}\n${code}` : code;
      codeLines = [];
    }
    if (outputLines.length > 0) {
      const cleanedOut = outputLines
        .map((l) => l.replace(/^Output:\s*/i, '').trim())
        .filter(Boolean)
        .join('\n');
      if (cleanedOut) {
        currentSub.sample_output = currentSub.sample_output
          ? `${currentSub.sample_output}\n${cleanedOut}`
          : cleanedOut;
      }
      outputLines = [];
    }
  };

  const finalizeExp = () => {
    flushSubBuffers();
    if (currentSub && currentExp) {
      currentExp.subtopics.push(currentSub);
      currentSub = null;
    }
    if (currentComp && currentExp) {
      currentExp.comparisons.push(currentComp);
      currentComp = null;
    }
    if (currentExp) {
      if (theoryLines.length > 0 && !currentExp.theory) {
        currentExp.theory = theoryLines.join(' ').replace(/\s+/g, ' ').trim();
        theoryLines = [];
      }
      // Update source_ref range if spanned multiple pages
      const refs = Array.from(
        new Set([currentExp.source_ref, ...currentExp.subtopics.map((s) => s.source_ref)]),
      );
      if (refs.length > 1 && refs.every((r) => /^Page \d+$/.test(r))) {
        const nums = refs.map((r) => Number(r.replace('Page ', ''))).sort((a, b) => a - b);
        currentExp.source_ref = `Pages ${nums[0]}–${nums[nums.length - 1]}`;
      }
      experiments.push(currentExp);
      currentExp = null;
    }
  };

  for (const { text, pageLabel } of taggedLines) {
    if (/^GENERAL\s+INSTRUCTIONS$/i.test(text)) {
      mode = 'instructions';
      continue;
    }

    const expMatch = text.match(EXPERIMENT_HEADING_RE);
    if (expMatch) {
      finalizeExp();
      currentExp = {
        number: Number(expMatch[1]),
        title: `Experiment ${expMatch[1]}: ${expMatch[2].trim()}`,
        source_ref: pageLabel,
        aim: null,
        theory: null,
        subtopics: [],
        comparisons: [],
        key_points: [],
        result: null,
      };
      mode = 'top';
      continue;
    }

    if (VIVA_HEADING_RE.test(text)) {
      finalizeExp();
      mode = 'viva';
      continue;
    }

    if (COMMANDS_HEADING_RE.test(text)) {
      finalizeExp();
      mode = 'commands';
      continue;
    }

    if (mode === 'viva') {
      const cleaned = text.replace(/^\d+[.)]\s*/, '').trim();
      if (cleaned.length >= 6 && !vivaQuestions.includes(cleaned)) {
        vivaQuestions.push(cleaned);
      }
      continue;
    }

    if (mode === 'commands') {
      if (/^Command\s*\/\s*Operator\s+Purpose$/i.test(text)) continue;
      const parsed = parseCommandPurposeLine(text);
      if (parsed && !seenCommands.has(parsed.command.toLowerCase())) {
        seenCommands.add(parsed.command.toLowerCase());
        commandsReference.push({ ...parsed, source_ref: pageLabel });
      }
      continue;
    }

    if (mode === 'instructions' && !currentExp) {
      const clean = cleanBulletOrLine(text);
      if (clean.length > 10 && !seenInstructions.has(clean.toLowerCase())) {
        seenInstructions.add(clean.toLowerCase());
        generalInstructions.push(clean);
      }
      continue;
    }

    if (!currentExp) continue;

    if (/^AIM\s*:/i.test(text)) {
      flushSubBuffers();
      const inline = text.replace(/^AIM\s*:\s*/i, '').trim();
      if (inline) currentExp.aim = inline;
      mode = 'exp_aim';
      continue;
    }

    if (/^Theory\s*\/\s*Introduction\s*:/i.test(text)) {
      flushSubBuffers();
      const inline = text.replace(/^Theory\s*\/\s*Introduction\s*:\s*/i, '').trim();
      if (inline) theoryLines.push(inline);
      mode = 'exp_theory';
      continue;
    }

    if (/^RESULT\s*:/i.test(text)) {
      flushSubBuffers();
      if (currentSub) {
        currentExp.subtopics.push(currentSub);
        currentSub = null;
      }
      if (currentComp) {
        currentExp.comparisons.push(currentComp);
        currentComp = null;
      }
      const inline = text.replace(/^RESULT\s*:\s*/i, '').trim();
      if (inline) currentExp.result = inline;
      mode = 'exp_result';
      continue;
    }

    const subMatch = text.match(SUBTOPIC_HEADING_RE);
    const specialSubMatch = text.match(
      /^(Sample\s+Assignment\s*:\s*.+|Optional\s+Extension\s*:\s*.+|Function\s+Syntax)$/i,
    );
    if (subMatch || specialSubMatch) {
      if (mode === 'exp_theory' && theoryLines.length > 0 && !currentExp.theory) {
        currentExp.theory = theoryLines.join(' ').replace(/\s+/g, ' ').trim();
        theoryLines = [];
      }
      flushSubBuffers();
      if (currentSub) {
        currentExp.subtopics.push(currentSub);
      }
      if (currentComp) {
        currentExp.comparisons.push(currentComp);
        currentComp = null;
      }
      currentSub = {
        title: subMatch ? `${subMatch[1]} ${subMatch[2].trim()}` : specialSubMatch![1].trim(),
        theory: null,
        code: null,
        sample_output: null,
        source_ref: pageLabel,
      };
      mode = specialSubMatch && /Function\s+Syntax/i.test(text) ? 'sub_code' : 'sub_theory';
      continue;
    }

    const compMatch = text.match(COMPARISON_HEADING_RE);
    if (compMatch) {
      flushSubBuffers();
      if (currentSub) {
        currentExp.subtopics.push(currentSub);
        currentSub = null;
      }
      if (currentComp) {
        currentExp.comparisons.push(currentComp);
      }
      currentComp = {
        title: compMatch[1].trim(),
        headers: ['Aspect A', 'Aspect B'],
        rows: [],
      };
      mode = 'exp_comparison';
      continue;
    }

    const impMatch = text.match(IMPORTANCE_HEADING_RE);
    if (impMatch) {
      flushSubBuffers();
      if (currentSub) {
        currentExp.subtopics.push(currentSub);
        currentSub = null;
      }
      mode = 'exp_importance';
      continue;
    }

    if (/^Theory\s*:/i.test(text)) {
      if (currentSub) {
        const inline = text.replace(/^Theory\s*:\s*/i, '').trim();
        if (inline) theoryLines.push(inline);
        mode = 'sub_theory';
      } else {
        const inline = text.replace(/^Theory\s*:\s*/i, '').trim();
        if (inline) theoryLines.push(inline);
        mode = 'exp_theory';
      }
      continue;
    }

    if (/^(?:MATLAB\s+Program|Program|Code)\s*:/i.test(text)) {
      if (currentSub) {
        if (theoryLines.length > 0) {
          currentSub.theory = theoryLines.join(' ').replace(/\s+/g, ' ').trim();
          theoryLines = [];
        }
        const inline = text.replace(/^(?:MATLAB\s+Program|Program|Code)\s*:\s*/i, '').trim();
        if (inline) codeLines.push(inline);
        mode = 'sub_code';
      }
      continue;
    }

    if (/^Sample\s+Output\s*:/i.test(text)) {
      if (currentSub) {
        if (codeLines.length > 0) {
          currentSub.code = formatCodeSnippet(codeLines);
          codeLines = [];
        }
        const inline = text.replace(/^Sample\s+Output\s*:\s*/i, '').trim();
        if (inline) outputLines.push(inline);
        mode = 'sub_output';
      }
      continue;
    }

    // Accumulate body lines into current section
    if (mode === 'exp_aim') {
      currentExp.aim = currentExp.aim ? `${currentExp.aim} ${text}` : text;
    } else if (mode === 'exp_theory') {
      if (/^[•*]/.test(text)) {
        currentExp.key_points.push(cleanBulletOrLine(text));
      } else {
        theoryLines.push(text);
      }
    } else if (mode === 'sub_theory') {
      theoryLines.push(text);
    } else if (mode === 'sub_code') {
      codeLines.push(text);
    } else if (mode === 'sub_output') {
      outputLines.push(text);
    } else if (mode === 'exp_result') {
      currentExp.result = currentExp.result ? `${currentExp.result} ${text}` : text;
    } else if (mode === 'exp_importance') {
      currentExp.key_points.push(cleanBulletOrLine(text));
    } else if (mode === 'exp_comparison' && currentComp) {
      if (/^(Command Window Script File|Script Function)$/i.test(text)) {
        currentComp.headers = /Script Function/i.test(text)
          ? ['Script', 'Function']
          : ['Command Window', 'Script File'];
      } else if (!isControlLabel(text)) {
        // Split sentence pair on ". " if two sentences exist on one row
        const parts = text.split(/(?<=\.)\s+(?=[A-Z])/);
        if (parts.length >= 2) {
          currentComp.rows.push([parts[0].trim(), parts.slice(1).join(' ').trim()]);
        } else {
          currentComp.rows.push([text, '']);
        }
      }
    }
  }

  finalizeExp();

  const overview =
    experiments.length > 0
      ? `"${documentTitle}" is a structured practical record spanning ${experiments.length} experiments (${experiments[0].title} through ${experiments[experiments.length - 1].title})${commandsReference.length > 0 ? `, plus ${commandsReference.length} key commands/operators` : ''}${vivaQuestions.length > 0 ? ` and ${vivaQuestions.length} viva review questions` : ''}.`
      : `"${documentTitle}" contains practical programming and laboratory material.`;

  return {
    kind: 'practical',
    overview,
    unsuitable_reason: null,
    general_instructions: generalInstructions,
    practical_experiments: experiments,
    commands_reference: commandsReference,
    viva_questions: vivaQuestions,
    theory_sections: [],
  };
}

export function parseCommandPurposeLine(line: string): { command: string; purpose: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 6) return null;

  // Match known multi-word commands first
  const multiMatch = trimmed.match(/^(close all|if-elseif-else)\s+(.{6,160})$/i);
  if (multiMatch) {
    return { command: multiMatch[1], purpose: multiMatch[2].trim() };
  }

  // Match function/command/operator followed by purpose starting with capitalized verb/phrase
  const stdMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*\(\)|[A-Za-z_][A-Za-z0-9_]*|\.\*|\.\/|\.\^|[:*+^;])\s+([A-Z][^\n]{5,180})$/);
  if (stdMatch) {
    return { command: stdMatch[1], purpose: stdMatch[2].trim() };
  }

  // Match "cmd: Purpose" or "cmd - Purpose"
  const sepMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_().*:/\-]{1,24})\s*[:\-–]\s+(.{6,180})$/);
  if (sepMatch) {
    return { command: sepMatch[1].trim(), purpose: sepMatch[2].trim() };
  }

  return null;
}

function parseTheoryStudyNotes(
  documentTitle: string,
  units: ExtractedUnit[],
): StructuredStudyNotes {
  const theorySections: TheorySection[] = [];
  const seenTitles = new Set<string>();

  for (const u of units) {
    const rawTitle = (u.headingPath || u.label || `Section ${u.number}`).trim();
    const title = isAdminOrNoiseText(rawTitle) ? `Section ${u.number}` : rawTitle;
    if (seenTitles.has(title.toLowerCase())) continue;
    seenTitles.add(title.toLowerCase());

    const lines = u.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !isAdminOrNoiseLine(l));

    const sentences = u.text
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 18 && !isAdminOrNoiseText(s));

    const definitions = sentences
      .filter((s) => /\b(is defined as|refers to|is a |are |means |consists of|follows the)\b/i.test(s))
      .slice(0, 4);

    const examples = sentences
      .filter((s) => /\b(for example|e\.g\.|such as|suppose|consider)\b/i.test(s))
      .slice(0, 3);

    const formulas = lines
      .filter((l) => l.length > 3 && l.length < 120 && /[=<>→]|O\([^)]+\)/.test(l))
      .slice(0, 5);

    const comparisons = sentences
      .filter((s) => /\b(whereas|while|unlike|compared to|difference between|in contrast)\b/i.test(s))
      .slice(0, 3);

    const keyConcepts = lines
      .filter((l) => l.length >= 15 && l.length <= 180 && /^[A-Z0-9•*-]/.test(l))
      .map(cleanBulletOrLine)
      .filter((l) => !isAdminOrNoiseText(l) && l.toLowerCase() !== title.toLowerCase())
      .slice(0, 6);

    const explanation = sentences
      .filter((s) => !definitions.includes(s) && !examples.includes(s))
      .slice(0, 4);

    const quickRevision = Array.from(new Set([...definitions.slice(0, 2), ...keyConcepts.slice(0, 2)])).slice(0, 4);

    const importantQuestions = [
      definitions[0] ? `What is ${title}, and what key principle does it follow?` : `Summarize the core concept of ${title}.`,
      examples[0] ? `Give a practical application or example of ${title}.` : null,
    ].filter((q): q is string => Boolean(q));

    theorySections.push({
      title,
      source_ref: u.label || `Section ${u.number}`,
      introduction: sentences[0] || null,
      definitions,
      explanation,
      key_concepts: keyConcepts,
      formulas,
      examples,
      comparisons,
      quick_revision: quickRevision,
      important_questions: importantQuestions,
    });
  }

  const overview =
    theorySections.length > 0
      ? `"${documentTitle}" covers ${theorySections.length} structured study sections: ${theorySections.map((s) => s.title).slice(0, 6).join(', ')}.`
      : `"${documentTitle}" study overview.`;

  return {
    kind: 'theory',
    overview,
    unsuitable_reason: null,
    general_instructions: [],
    practical_experiments: [],
    commands_reference: [],
    viva_questions: [],
    theory_sections: theorySections,
  };
}

export function buildStructuredStudyNotes(params: {
  documentTitle: string;
  units: ExtractedUnit[];
  unsuitableReason?: string | null;
}): StructuredStudyNotes {
  if (params.unsuitableReason || params.units.length === 0) {
    return {
      kind: 'theory',
      overview:
        params.unsuitableReason ||
        'No meaningful educational content was found in this document.',
      unsuitable_reason:
        params.unsuitableReason ||
        'No meaningful educational content was found in this document.',
      general_instructions: [],
      practical_experiments: [],
      commands_reference: [],
      viva_questions: [],
      theory_sections: [],
    };
  }

  const fullText = params.units.map((u) => u.text).join('\n');
  const kind = detectDocumentKind(fullText);
  if (kind === 'practical') {
    const practical = parsePracticalStudyNotes(params.documentTitle, params.units);
    if (practical.practical_experiments.length > 0) {
      return practical;
    }
  }
  return parseTheoryStudyNotes(params.documentTitle, params.units);
}
