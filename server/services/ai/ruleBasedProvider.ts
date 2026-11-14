import crypto from 'node:crypto';
import type { DocumentChunkRow } from '../../repositories/documentRepo.ts';
import type { QuestionSecret } from '../../repositories/assessmentRepo.ts';
import type { CauseClass } from '../../repositories/misconceptionRepo.ts';
import type { SourceRef, TopicRow } from '../../repositories/topicRepo.ts';
import type { TutorCitation, TutorMessageRow } from '../../repositories/tutorRepo.ts';
import {
  buildStructuredStudyNotes,
  isAdminOrNoiseLine,
  isAdminOrNoiseText,
  parseCommandPurposeLine,
  type PracticalExperiment,
  type StructuredStudyNotes,
} from '../documents/cleaner.ts';
import type { ExtractedUnit } from '../documents/extractors.ts';
import type {
  AIProvider,
  AnalyzedRelationDraft,
  AnalyzedTopicDraft,
  DocumentAnalysisOutput,
  EvaluationOutput,
  GeneratedQuestionDraft,
  MisconceptionDiagnosisOutput,
  TutorResponseOutput,
} from './provider.ts';

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with',
  'by', 'as', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'be', 'are', 'was', 'were',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
  'should', 'may', 'might', 'about', 'what', 'when', 'where', 'why', 'how', 'who', 'whom',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'explain', 'tell', 'me', 'define', 'describe', 'please', 'give', 'example',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'topic'
  );
}

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex').slice(0, 24);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !isAdminOrNoiseText(s));
}

function toSourceRef(chunk: DocumentChunkRow): SourceRef {
  const prefix =
    chunk.source_kind === 'page' ? 'Page' : chunk.source_kind === 'slide' ? 'Slide' : 'Section';
  const rawLabel = chunk.heading_path || `${prefix} ${chunk.source_start}`;
  const label = isAdminOrNoiseText(rawLabel) ? `${prefix} ${chunk.source_start}` : rawLabel;
  return {
    kind: chunk.source_kind,
    number: chunk.source_start,
    label,
    chunk_id: chunk.id,
  };
}

function cleanTruncate(text: string, maxLen = 148): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen - 3);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim() + '...';
}

// BM25 + TF-IDF ranking strictly over user's chunks
export function rankChunksBM25(
  query: string,
  chunks: DocumentChunkRow[],
): Array<{ chunk: DocumentChunkRow; score: number }> {
  if (chunks.length === 0) return [];
  const qTerms = tokenize(query);
  if (qTerms.length === 0) return [];

  const docTokens = chunks.map((c) => tokenize(c.content + ' ' + c.heading_path));
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(1, docTokens.length);
  const N = chunks.length;

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const uniqueTerm of new Set(tokens)) {
      df.set(uniqueTerm, (df.get(uniqueTerm) || 0) + 1);
    }
  }

  const k1 = 1.5;
  const b = 0.75;
  const lowerQuery = query.toLowerCase().trim();

  const scored = chunks.map((chunk, idx) => {
    const tokens = docTokens[idx];
    const dl = Math.max(1, tokens.length);
    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    let bm25 = 0;
    let matchedTerms = 0;
    for (const qt of new Set(qTerms)) {
      const tf = tfMap.get(qt) || 0;
      if (tf > 0) {
        matchedTerms += 1;
        const docFreq = df.get(qt) || 0;
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
        const num = tf * (k1 + 1);
        const den = tf + k1 * (1 - b + (b * dl) / Math.max(1, avgLen));
        bm25 += idf * (num / den);
      }
    }

    const coverage = matchedTerms / new Set(qTerms).size;
    const phraseBonus =
      lowerQuery.length >= 4 && chunk.content.toLowerCase().includes(lowerQuery) ? 1.5 : 0;
    const headingBonus = qTerms.some((t) => chunk.heading_path.toLowerCase().includes(t)) ? 0.5 : 0;

    const score = coverage * 0.45 + Math.min(1, bm25 / 5) * 0.45 + (phraseBonus + headingBonus) * 0.25;
    return { chunk, score, matchedTerms };
  });

  return scored
    .filter((s) => s.matchedTerms > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({ chunk, score }));
}

const KNOWN_MISCONCEPTION_PAIRS: Array<{
  key: string;
  label: string;
  expectedTerms: string[];
  confusedTerms: string[];
  explanation: string;
  correctiveTip: string;
}> = [
  {
    key: 'stack_lifo_vs_fifo',
    label: 'LIFO (Stack) vs FIFO (Queue) Confusion',
    expectedTerms: ['lifo', 'last in first out', 'top', 'stack', 'pop'],
    confusedTerms: ['fifo', 'first in first out', 'oldest', 'front', 'bottom', 'dequeue', 'queue'],
    explanation:
      'You applied Queue (FIFO — First-In, First-Out) behavior to a Stack (LIFO — Last-In, First-Out). In a stack, POP always removes the most recently pushed element from the TOP, not the oldest element at the bottom.',
    correctiveTip:
      'Think of a vertical stack of plates: PUSH places a plate on top, and POP removes from the top (LIFO). A Queue uses FIFO, removing from the front (DEQUEUE).',
  },
  {
    key: 'queue_fifo_vs_lifo',
    label: 'FIFO (Queue) vs LIFO (Stack) Confusion',
    expectedTerms: ['fifo', 'first in first out', 'front', 'queue', 'dequeue'],
    confusedTerms: ['lifo', 'last in first out', 'newest', 'top', 'stack', 'pop'],
    explanation:
      'You applied Stack (LIFO) removal rules to a Queue. Queues follow FIFO (First-In, First-Out), so DEQUEUE removes the earliest inserted element at the front.',
    correctiveTip:
      'Picture a ticket line: the first person in line is served first (FIFO). Enqueue adds to the rear; Dequeue removes from the front.',
  },
  {
    key: 'complexity_o1_vs_on',
    label: 'Constant O(1) vs Linear O(n) Time Complexity Confusion',
    expectedTerms: ['o(1)', 'constant'],
    confusedTerms: ['o(n)', 'linear', 'o(log n)', 'o(n^2)'],
    explanation:
      'You confused linear traversal time O(n) with constant-time direct access O(1). Direct index/top pointer operations do not scale with input size n.',
    correctiveTip:
      'Ask: does the number of steps grow if the structure holds 10,000 items instead of 10? If not, it is O(1).',
  },
  {
    key: 'bfs_vs_dfs',
    label: 'BFS (Queue/Level) vs DFS (Stack/Depth) Traversal Confusion',
    expectedTerms: ['bfs', 'breadth', 'level', 'queue'],
    confusedTerms: ['dfs', 'depth', 'stack', 'recursion', 'backtrack'],
    explanation:
      'You mixed up Breadth-First Search (level-by-level via a Queue) with Depth-First Search (branch-by-branch via a Stack/recursion).',
    correctiveTip:
      'BFS = Breadth = Queue (explores neighbors layer by layer). DFS = Depth = Stack (goes deep before backtracking).',
  },
  {
    key: 'matlab_elementwise_vs_matrix',
    label: 'Element-wise (.*) vs Matrix (*) Multiplication Confusion',
    expectedTerms: ['element-wise', '.*'],
    confusedTerms: ['matrix multiplication', 'dot product', 'inner dimensions'],
    explanation:
      'In MATLAB, .* multiplies corresponding elements of equal-sized arrays, whereas * performs linear-algebraic matrix multiplication requiring columns(A) == rows(B).',
    correctiveTip:
      'Remember the leading dot: .* and .^ always mean "do it element-by-element". Without a dot (*), MATLAB performs full matrix multiplication.',
  },
  {
    key: 'matlab_one_based_indexing',
    label: 'MATLAB 1-Based vs 0-Based Array Indexing Confusion',
    expectedTerms: ['one-based', '1-based', 'a(1)', 'third'],
    confusedTerms: ['zero-based', '0-based', 'index 0', 'fourth'],
    explanation:
      'MATLAB uses 1-based indexing: the first element of array A is A(1), and the third element is A(3) — unlike C/Python where indices start at 0.',
    correctiveTip:
      'Always count starting at 1 in MATLAB: A(1) is first, A(2) is second, A(3) is third.',
  },
  {
    key: 'matlab_script_vs_function',
    label: 'MATLAB Script vs Function Workspace & File Rules',
    expectedTerms: ['local workspace', 'function name', 'input and output'],
    confusedTerms: ['base workspace', 'no formal input'],
    explanation:
      'Unlike scripts that share the base workspace, MATLAB user-defined functions execute in their own local workspace, accept formal input/output arguments, and are saved in a .m file matching the function name.',
    correctiveTip:
      'Scripts = shared base workspace & sequential commands; Functions = local workspace + formal arguments + filename matching function name.',
  },
  {
    key: 'matlab_plot_vs_stem',
    label: 'Continuous plot() vs Discrete stem() Plotting Confusion',
    expectedTerms: ['discrete-time', 'stem()', 'stem'],
    confusedTerms: ['continuous', 'wireframe', '3-d surface', 'histogram'],
    explanation:
      'stem() draws discrete-time sequence samples as stems with markers, whereas plot() connects data points to represent continuous signals or curves.',
    correctiveTip:
      'Think "stem = discrete samples"; "plot = connected continuous curve".',
  },
];

function reconstructUnitsFromChunks(chunks: DocumentChunkRow[]): ExtractedUnit[] {
  const byUnit = new Map<number, DocumentChunkRow[]>();
  for (const chunk of chunks) {
    const arr = byUnit.get(chunk.source_start) || [];
    arr.push(chunk);
    byUnit.set(chunk.source_start, arr);
  }
  return Array.from(byUnit.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([num, group]) => {
      const first = group[0];
      const prefix =
        first.source_kind === 'page' ? 'Page' : first.source_kind === 'slide' ? 'Slide' : 'Section';
      return {
        kind: first.source_kind,
        number: num,
        label: `${prefix} ${num}`,
        headingPath: first.heading_path || `${prefix} ${num}`,
        text: group.map((c) => c.content).join('\n'),
      };
    });
}

function findRefsForExperiment(
  exp: PracticalExperiment,
  chunks: DocumentChunkRow[],
): SourceRef[] {
  const pageMatches = exp.source_ref.match(/\d+/g)?.map(Number) || [];
  const expTitleWord = exp.title.replace(/^Experiment\s+\d+\s*:\s*/i, '').trim().toLowerCase();
  const matched = chunks.filter((c) => {
    if (pageMatches.length === 1 && c.source_start === pageMatches[0]) return true;
    if (pageMatches.length >= 2 && c.source_start >= pageMatches[0] && c.source_start <= pageMatches[1]) {
      return true;
    }
    return expTitleWord.length > 4 && c.content.toLowerCase().includes(expTitleWord);
  });
  return (matched.length > 0 ? matched : chunks.slice(0, 1)).slice(0, 4).map(toSourceRef);
}

export function isValidQuestionDraft(draft: GeneratedQuestionDraft): boolean {
  const prompt = (draft.prompt || '').trim();
  if (prompt.length < 18 || prompt.length > 380) return false;
  if (/\[Review\s*#/i.test(prompt)) return false;
  if (isAdminOrNoiseText(prompt)) return false;
  if (/_{3,}/.test(prompt)) return false;

  if (draft.type === 'mcq') {
    if (!Array.isArray(draft.options) || draft.options.length !== 4) return false;
    const seen = new Set<string>();
    for (const opt of draft.options) {
      const clean = (opt || '').trim();
      if (clean.length < 1 || clean.length > 165) return false;
      if (/_{2,}/.test(clean)) return false;
      if (isAdminOrNoiseText(clean)) return false;
      if (/unrecognized|unrelated external sorting algorithm/i.test(clean)) return false;
      if (seen.has(clean.toLowerCase())) return false;
      seen.add(clean.toLowerCase());
    }
    if (!draft.options.includes(draft.answer_key.correct)) return false;
  } else if (draft.type === 'true_false') {
    if (
      !Array.isArray(draft.options) ||
      draft.options.length !== 2 ||
      draft.options[0] !== 'True' ||
      draft.options[1] !== 'False'
    ) {
      return false;
    }
    if (/Sample Output:|MATLAB Program:|clc;\s*clear/i.test(prompt)) return false;
  }

  return true;
}

export const ruleBasedProvider: AIProvider = {
  id: 'rule_based',
  label: 'Rule-Based Engine',
  modelName: 'rule-based-v2',

  async analyzeDocument({
    documentTitle,
    chunks,
    units: providedUnits,
    unsuitableReason,
  }): Promise<DocumentAnalysisOutput> {
    const units = providedUnits && providedUnits.length > 0 ? providedUnits : reconstructUnitsFromChunks(chunks);
    const studyNotes = buildStructuredStudyNotes({
      documentTitle,
      units,
      unsuitableReason: unsuitableReason || (chunks.length === 0 ? 'No educational text extracted.' : null),
    });

    if (studyNotes.unsuitable_reason || chunks.length === 0) {
      return {
        summary: studyNotes.overview,
        learningObjectives: [],
        examQuestions: [],
        studyNotes,
        topics: [],
        relations: [],
        model: this.modelName,
        promptVersion: 'rule-based-v2',
      };
    }

    const topics: AnalyzedTopicDraft[] = [];
    const relations: AnalyzedRelationDraft[] = [];
    const usedSlugs = new Set<string>();
    const makeUniqueSlug = (name: string) => {
      const base = slugify(name);
      let s = base;
      let i = 2;
      while (usedSlugs.has(s)) {
        s = `${base}-${i++}`;
      }
      usedSlugs.add(s);
      return s;
    };

    let orderIdx = 0;
    const parentTopics: AnalyzedTopicDraft[] = [];

    if (studyNotes.kind === 'practical' && studyNotes.practical_experiments.length > 0) {
      for (const exp of studyNotes.practical_experiments) {
        const refs = findRefsForExperiment(exp, chunks);
        const combinedSubTheory = exp.subtopics
          .map((s) => s.theory)
          .filter(Boolean)
          .join(' ');
        const combinedText = [exp.aim, exp.theory, combinedSubTheory, exp.result].filter(Boolean).join(' ');
        const topicId = crypto.randomUUID();

        const difficulty: 'beginner' | 'intermediate' | 'advanced' =
          /\b(convolution|3-d|mesh|meshgrid|quadratic|fibonacci|factorial|local workspace)\b/i.test(combinedText)
            ? 'advanced'
            : /\b(introduction|arithmetic|variables|basic|creating|indexing)\b/i.test(exp.title)
              ? 'beginner'
              : 'intermediate';

        const formulas = Array.from(
          new Set(
            [exp.theory || '', ...exp.subtopics.map((s) => s.theory || '')]
              .join('\n')
              .split(/(?<=[.;])\s+/)
              .map((s) => s.trim())
              .filter((s) => s.length >= 6 && s.length <= 105 && /[=+\-*/^:]|L\+M-1|O\([^)]+\)/.test(s)),
          ),
        ).slice(0, 4);

        const examples = exp.subtopics
          .filter((s) => s.code)
          .slice(0, 2)
          .map((s) => `${s.title}: ${s.sample_output ? s.sample_output.replace(/\n/g, ' | ').slice(0, 120) : s.title}`);

        const topicDraft: AnalyzedTopicDraft = {
          id: topicId,
          parent_id: null,
          kind: 'topic',
          name: exp.title.slice(0, 80),
          slug: makeUniqueSlug(exp.title),
          summary: exp.aim || exp.theory || exp.result || `Practical exercises covering ${exp.title}.`,
          definition: exp.theory || exp.aim || exp.result || null,
          formulas,
          examples,
          difficulty,
          source_refs: refs,
          grounded: refs.length > 0,
          order_index: orderIdx++,
        };
        topics.push(topicDraft);
        parentTopics.push(topicDraft);

        // Add up to 4 clean sub-concepts per Experiment
        for (const sub of exp.subtopics.slice(0, 4)) {
          const cleanSubTitle = sub.title.trim();
          if (isAdminOrNoiseText(cleanSubTitle)) continue;
          const subSummary = sub.theory || (sub.sample_output ? `Output behavior: ${sub.sample_output.slice(0, 140)}` : '');
          if (!subSummary || subSummary.length < 12) continue;

          const subId = crypto.randomUUID();
          const subRef = chunks.find((c) => `Page ${c.source_start}` === sub.source_ref) || chunks[0];
          const subDraft: AnalyzedTopicDraft = {
            id: subId,
            parent_id: topicId,
            kind: 'concept',
            name: cleanSubTitle.slice(0, 80),
            slug: makeUniqueSlug(cleanSubTitle),
            summary: subSummary,
            definition: sub.theory || subSummary,
            formulas: [],
            examples: sub.sample_output ? [sub.sample_output.replace(/\n/g, ' | ').slice(0, 140)] : [],
            difficulty: topicDraft.difficulty,
            source_refs: subRef ? [toSourceRef(subRef)] : refs.slice(0, 1),
            grounded: true,
            order_index: orderIdx++,
          };
          topics.push(subDraft);
          relations.push({
            id: crypto.randomUUID(),
            from_topic_id: subId,
            to_topic_id: topicId,
            relation: 'part_of',
            source_refs: subDraft.source_refs,
          });
        }
      }

      if (studyNotes.commands_reference.length > 0) {
        const lastChunk = chunks[chunks.length - 1];
        const cmdId = crypto.randomUUID();
        const cmdTopic: AnalyzedTopicDraft = {
          id: cmdId,
          parent_id: null,
          kind: 'topic',
          name: 'Essential Commands & Operators Reference',
          slug: makeUniqueSlug('essential-commands-and-operators'),
          summary: `Core reference covering ${studyNotes.commands_reference.length} commands and operators including ${studyNotes.commands_reference
            .slice(0, 5)
            .map((c) => c.command)
            .join(', ')}.`,
          definition: `Key commands and operators used across workspace control, matrix operations, plotting, control flow, and signal processing.`,
          formulas: studyNotes.commands_reference
            .slice(0, 4)
            .map((c) => `${c.command} -> ${c.purpose}`),
          examples: [],
          difficulty: 'intermediate',
          source_refs: lastChunk ? [toSourceRef(lastChunk)] : [],
          grounded: Boolean(lastChunk),
          order_index: orderIdx++,
        };
        topics.push(cmdTopic);
        parentTopics.push(cmdTopic);
      }
    } else {
      // Theory / Lecture / Textbook document grouping
      const groupMap = new Map<string, DocumentChunkRow[]>();
      for (const chunk of chunks) {
        const rawHeading = (chunk.heading_path || `Section ${chunk.source_start}`).trim();
        const cleanHeading = isAdminOrNoiseText(rawHeading)
          ? `Section ${chunk.source_start}`
          : rawHeading;
        const arr = groupMap.get(cleanHeading) || [];
        arr.push(chunk);
        groupMap.set(cleanHeading, arr);
      }

      for (const [heading, groupChunks] of groupMap.entries()) {
        const combined = groupChunks.map((c) => c.content).join(' ');
        const sentences = splitSentences(combined);
        const cleanName =
          heading.replace(/^Page \d+$/i, '').trim() ||
          extractSectionTitle(combined, `Section ${groupChunks[0].source_start}`);
        if (isAdminOrNoiseText(cleanName)) continue;

        const definitions = sentences.filter((s) =>
          /\b(is defined as|refers to|is a |are |means |consists of|follows the)\b/i.test(s),
        );
        const formulas = combined
          .split('\n')
          .map((l) => l.trim())
          .filter(
            (l) =>
              l.length > 3 &&
              l.length < 120 &&
              !isAdminOrNoiseLine(l) &&
              /[=<>→]|O\([^)]+\)/i.test(l),
          )
          .slice(0, 4);
        const examples = sentences
          .filter((s) => /\b(for example|e\.g\.|such as|suppose|consider)\b/i.test(s))
          .slice(0, 3);

        const refs: SourceRef[] = groupChunks.slice(0, 3).map(toSourceRef);
        const topicId = crypto.randomUUID();
        const difficulty: 'beginner' | 'intermediate' | 'advanced' =
          /\b(advanced|complexity|theorem|proof|amortized|optimization|concurrent)\b/i.test(combined)
            ? 'advanced'
            : /\b(introduction|overview|basic|fundamental|definition)\b/i.test(combined)
              ? 'beginner'
              : 'intermediate';

        const topicDraft: AnalyzedTopicDraft = {
          id: topicId,
          parent_id: null,
          kind: 'topic',
          name: cleanName.slice(0, 80),
          slug: makeUniqueSlug(cleanName),
          summary: sentences.slice(0, 2).join(' ') || cleanTruncate(combined, 200),
          definition: definitions[0] || sentences[0] || null,
          formulas,
          examples,
          difficulty,
          source_refs: refs,
          grounded: refs.length > 0,
          order_index: orderIdx++,
        };
        topics.push(topicDraft);
        parentTopics.push(topicDraft);

        const conceptMatches = extractConceptsFromChunks(groupChunks);
        for (const c of conceptMatches.slice(0, 4)) {
          const subId = crypto.randomUUID();
          const subDraft: AnalyzedTopicDraft = {
            id: subId,
            parent_id: topicId,
            kind: 'concept',
            name: c.name,
            slug: makeUniqueSlug(c.name),
            summary: c.explanation,
            definition: c.explanation,
            formulas: [],
            examples: [],
            difficulty: topicDraft.difficulty,
            source_refs: [toSourceRef(c.chunk)],
            grounded: true,
            order_index: orderIdx++,
          };
          topics.push(subDraft);
          relations.push({
            id: crypto.randomUUID(),
            from_topic_id: subId,
            to_topic_id: topicId,
            relation: 'part_of',
            source_refs: [toSourceRef(c.chunk)],
          });
        }
      }
    }

    // Add sequential prerequisite_of relations among top-level topics
    for (let i = 0; i < parentTopics.length - 1; i++) {
      relations.push({
        id: crypto.randomUUID(),
        from_topic_id: parentTopics[i].id,
        to_topic_id: parentTopics[i + 1].id,
        relation: 'prerequisite_of',
        source_refs: parentTopics[i].source_refs.slice(0, 1),
      });
    }

    // Detect contrasting pairs
    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        const a = topics[i].name.toLowerCase();
        const b = topics[j].name.toLowerCase();
        const isPair =
          (a.includes('stack') && b.includes('queue')) ||
          (a.includes('queue') && b.includes('stack')) ||
          (a.includes('lifo') && b.includes('fifo')) ||
          (a.includes('bfs') && b.includes('dfs'));
        if (isPair) {
          relations.push({
            id: crypto.randomUUID(),
            from_topic_id: topics[i].id,
            to_topic_id: topics[j].id,
            relation: 'contrasts_with',
            source_refs: topics[i].source_refs.slice(0, 1),
          });
        }
      }
    }

    // Generate clean, non-repetitive summary & learning objectives
    const summary =
      studyNotes.kind === 'practical' && studyNotes.practical_experiments.length > 0
        ? studyNotes.overview
        : `${studyNotes.overview} ${parentTopics
            .slice(0, 3)
            .map((t) => t.definition || t.summary)
            .filter(Boolean)
            .join(' ')}`.trim();

    const learningObjectives: string[] = [];
    const seenObj = new Set<string>();
    if (studyNotes.kind === 'practical' && studyNotes.practical_experiments.length > 0) {
      for (const exp of studyNotes.practical_experiments) {
        const objText = exp.aim
          ? `${exp.title}: ${exp.aim.replace(/^To\s+/i, 'Understand how to ')}`
          : `Complete practical workflows in ${exp.title}.`;
        const norm = objText.toLowerCase();
        if (!seenObj.has(norm)) {
          seenObj.add(norm);
          learningObjectives.push(objText);
        }
        if (learningObjectives.length >= 6) break;
      }
    } else {
      for (const t of parentTopics) {
        const objText = t.definition
          ? `Explain ${t.name}: ${cleanTruncate(t.definition, 110)}`
          : `Master the core concepts and applications of ${t.name}.`;
        const norm = objText.toLowerCase();
        if (!seenObj.has(norm)) {
          seenObj.add(norm);
          learningObjectives.push(objText);
        }
        if (learningObjectives.length >= 6) break;
      }
    }

    const examQuestions = (
      studyNotes.kind === 'practical' && studyNotes.viva_questions.length > 0
        ? studyNotes.viva_questions.slice(0, 6).map((vq, idx) => ({
            prompt: vq,
            topic: parentTopics[idx % Math.max(1, parentTopics.length)]?.name || documentTitle,
            difficulty: 'intermediate',
          }))
        : parentTopics.slice(0, 4).map((t) => ({
            prompt: `Explain ${t.name} and illustrate it with an example from the study material.`,
            topic: t.name,
            difficulty: t.difficulty,
          }))
    );

    return {
      summary,
      learningObjectives,
      examQuestions,
      studyNotes,
      topics,
      relations,
      model: this.modelName,
      promptVersion: 'rule-based-v2',
    };
  },

  async answerTutor({ query, chunks, topics, explanationStyle }): Promise<TutorResponseOutput> {
    const ranked = rankChunksBM25(query, chunks);

    if (ranked.length === 0 || ranked[0].score < 0.14) {
      return {
        content:
          "I couldn't find sufficient evidence in your uploaded study material to answer this confidently.\n\nTry selecting additional study documents, rephrasing with key terms from your notes, or asking about one of your extracted topics.",
        citations: [],
        grounding: 'not_in_document',
        followUps: topics.slice(0, 3).map((t) => `Explain ${t.name} from my notes`),
        model: this.modelName,
        providerLabel: this.label,
      };
    }

    const topMatches = ranked.slice(0, 3);
    const citations: TutorCitation[] = topMatches.map(({ chunk }) => ({
      ...toSourceRef(chunk),
      document_id: chunk.document_id,
      excerpt: chunk.content.slice(0, 280) + (chunk.content.length > 280 ? '...' : ''),
    }));

    const queryLower = query.toLowerCase();
    const relevantSentences: string[] = [];
    for (const { chunk } of topMatches) {
      const sents = splitSentences(chunk.content);
      const qTerms = tokenize(query);
      const picked = sents
        .map((s) => ({
          s,
          hits: qTerms.filter((t) => s.toLowerCase().includes(t)).length,
        }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 2)
        .map((x) => x.s);
      for (const p of picked) {
        if (!relevantSentences.includes(p)) relevantSentences.push(p);
      }
    }

    const primaryChunk = topMatches[0].chunk;
    const primaryLabel = toSourceRef(primaryChunk).label;
    const excerptBody =
      relevantSentences.length > 0
        ? relevantSentences.join(' ')
        : primaryChunk.content.slice(0, 400);

    let styledContent = '';
    if (explanationStyle === 'beginner') {
      styledContent = `**Simple Breakdown (from ${primaryLabel}):**\n\n${excerptBody}\n\n**Key Takeaway:** Focus on the core definition above before moving to edge cases.`;
    } else if (explanationStyle === 'step_by_step') {
      const steps = (relevantSentences.length > 0 ? relevantSentences : [excerptBody]).slice(0, 3);
      styledContent = `**Step-by-Step Explanation (grounded in your notes):**\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    } else if (explanationStyle === 'example_based') {
      const exampleSent = splitSentences(topMatches.map((m) => m.chunk.content).join(' ')).find((s) =>
        /\b(example|e\.g\.|such as|suppose|consider)\b/i.test(s),
      );
      styledContent = `**Concept & Example (from ${primaryLabel}):**\n\n${excerptBody}${exampleSent ? `\n\n**Example in your material:** ${exampleSent}` : ''}`;
    } else if (explanationStyle === 'exam_oriented') {
      styledContent = `**Exam-Focused Summary (from ${primaryLabel}):**\n\n- **Core Fact:** ${relevantSentences[0] || excerptBody}\n- **Watch Out For:** Distinguish this carefully from neighboring concepts in your notes so you don't confuse rules under exam pressure.`;
    } else {
      styledContent = `**Academic Summary (from ${primaryLabel}):**\n\n${excerptBody}`;
    }

    const matchedTopics = topics.filter(
      (t) =>
        queryLower.includes(t.name.toLowerCase()) ||
        topMatches.some((m) => m.chunk.content.toLowerCase().includes(t.name.toLowerCase())),
    );
    const followUps =
      matchedTopics.length > 0
        ? matchedTopics.slice(0, 2).map((t) => `Give me a practice question on ${t.name}`)
        : topics.slice(0, 2).map((t) => `How does ${t.name} connect to this?`);

    return {
      content: styledContent,
      citations,
      grounding: 'document',
      followUps,
      model: this.modelName,
      providerLabel: this.label,
    };
  },

  async generateQuestions({
    topics,
    chunks,
    count,
    difficulty,
    excludedHashes,
    roundNo = 1,
  }): Promise<GeneratedQuestionDraft[]> {
    const validTopics = topics.filter(
      (t) => !isAdminOrNoiseText(t.name) && t.name.length >= 3,
    );
    if (validTopics.length === 0 || chunks.length === 0) {
      return [];
    }

    const drafts: GeneratedQuestionDraft[] = [];
    const seenPromptRoots = new Set<string>();
    const allChunksText = chunks.map((c) => c.content).join('\n');

    const tryAddDraft = (draft: GeneratedQuestionDraft): boolean => {
      if (drafts.length >= count) return false;
      if (excludedHashes.has(draft.question_hash)) return false;
      const rootKey = draft.prompt.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenPromptRoots.has(rootKey)) return false;
      if (!isValidQuestionDraft(draft)) return false;
      excludedHashes.add(draft.question_hash);
      seenPromptRoots.add(rootKey);
      drafts.push(draft);
      return true;
    };

    // Helper: pick matching topic & source_refs for a concept keyword
    const findTopicAndRefs = (keyword: string): { topic: TopicRow; refs: SourceRef[] } => {
      const lowerKw = keyword.toLowerCase();
      const matchedTopic =
        validTopics.find(
          (t) =>
            t.name.toLowerCase().includes(lowerKw) ||
            (t.definition || '').toLowerCase().includes(lowerKw) ||
            (t.summary || '').toLowerCase().includes(lowerKw),
        ) || validTopics.find((t) => t.kind === 'topic') || validTopics[0];
      const matchedChunk = chunks.find((c) => c.content.toLowerCase().includes(lowerKw));
      const refs = matchedChunk ? [toSourceRef(matchedChunk)] : matchedTopic.source_refs;
      return { topic: matchedTopic, refs };
    };

    // -------------------------------------------------------------------------
    // 1. High-Priority Domain Misconception Probes (Data Structures etc.)
    // Keeps Stack LIFO / Queue FIFO diagnostics crisp and deterministic
    // -------------------------------------------------------------------------
    for (const topic of validTopics) {
      if (drafts.length >= count) break;
      const lowerAll = `${topic.name} ${topic.definition || ''} ${topic.summary || ''}`.toLowerCase();
      if (lowerAll.includes('stack') || lowerAll.includes('lifo') || lowerAll.includes('pop')) {
        const p2 = `When performing a POP operation on a Stack (${topic.name}), which element is removed?`;
        const correct2 = 'The most recently added element at the TOP (LIFO — Last-In, First-Out).';
        const opts2 = shuffleDeterministic(
          [
            correct2,
            'The oldest element at the bottom/front (FIFO — First-In, First-Out).',
            'A random element selected by index.',
            'All elements currently stored in the structure.',
          ],
          p2 + roundNo,
        );
        tryAddDraft({
          topic_id: topic.id,
          type: 'mcq',
          difficulty: 'intermediate',
          round_no: roundNo,
          prompt: p2,
          options: opts2,
          answer_key: { correct: correct2, keywords: ['lifo', 'top', 'most recent', 'last in'] },
          rubric: { misconception_probe: 'stack_lifo_vs_fifo' },
          explanation: `A Stack follows LIFO (Last-In, First-Out): PUSH adds to the top and POP removes from the top.`,
          hints: [
            'Recall the acronym LIFO vs FIFO.',
            'Think about which end of a stack allows both PUSH and POP.',
          ],
          source_refs: topic.source_refs,
          question_hash: hashPrompt(p2),
        });
      } else if (lowerAll.includes('queue') || lowerAll.includes('fifo') || lowerAll.includes('dequeue')) {
        const p2 = `When performing DEQUEUE on a Queue (${topic.name}), which element is removed?`;
        const correct2 = 'The oldest element at the FRONT (FIFO — First-In, First-Out).';
        const opts2 = shuffleDeterministic(
          [
            correct2,
            'The newest element at the top/rear (LIFO — Last-In, First-Out).',
            'The middle element of the queue.',
            'The element with the highest numeric value.',
          ],
          p2 + roundNo,
        );
        tryAddDraft({
          topic_id: topic.id,
          type: 'mcq',
          difficulty: 'intermediate',
          round_no: roundNo,
          prompt: p2,
          options: opts2,
          answer_key: { correct: correct2, keywords: ['fifo', 'front', 'oldest', 'first in'] },
          rubric: { misconception_probe: 'queue_fifo_vs_lifo' },
          explanation: `A Queue follows FIFO (First-In, First-Out): ENQUEUE adds at the rear and DEQUEUE removes from the front.`,
          hints: ['Recall FIFO vs LIFO.', 'Which end of a waiting line gets served first?'],
          source_refs: topic.source_refs,
          question_hash: hashPrompt(p2),
        });
      }
    }

    // -------------------------------------------------------------------------
    // 2. Grounded Code, Command, Operator & Output Questions (Practical / MATLAB etc.)
    // Only generated when the exact concepts/snippets appear in the user's document!
    // -------------------------------------------------------------------------
    const practicalQuestionTemplates: Array<{
      detect: RegExp;
      keyword: string;
      difficulty: 'beginner' | 'intermediate' | 'advanced';
      prompt: string;
      correct: string;
      distractors: [string, string, string];
      explanation: string;
      hint: string;
    }> = [
      {
        detect: /element-wise multiplication|\.\*/i,
        keyword: '.*',
        difficulty: 'intermediate',
        prompt: 'In MATLAB, what is the key difference between the operators * and .*?',
        correct: '* performs matrix multiplication, whereas .* performs element-wise multiplication on equal-sized arrays.',
        distractors: [
          '.* performs matrix multiplication, whereas * performs element-wise multiplication.',
          'Both * and .* always perform identical scalar-only multiplication.',
          '.* calculates the matrix determinant, whereas * transposes the matrix.',
        ],
        explanation:
          'In MATLAB, * requires inner matrix dimensions to match for matrix multiplication, while .* multiplies corresponding elements of equal-sized arrays.',
        hint: 'Notice the dot prefix (.) on MATLAB element-wise operators.',
      },
      {
        detect: /semicolon\s*\(;\)|suppresses display/i,
        keyword: 'semicolon',
        difficulty: 'beginner',
        prompt: 'What is the effect of placing a semicolon (;) at the end of a MATLAB statement?',
        correct: 'It executes the statement while suppressing its output from being displayed in the Command Window.',
        distractors: [
          'It comments out the line so MATLAB skips executing it.',
          'It deletes all variables currently stored in the Workspace.',
          'It immediately closes all open Figure windows.',
        ],
        explanation:
          'Ending a MATLAB statement with ; still computes and stores the result, but prevents printing it to the Command Window.',
        hint: 'Compare x=10 (prints x = 10) vs y=20; (stays silent).',
      },
      {
        detect: /\bans\b.*default variable|unassigned expression result/i,
        keyword: 'use of ans',
        difficulty: 'beginner',
        prompt: 'In MATLAB, when an expression result is not assigned to a named variable, where is it stored?',
        correct: 'In the default MATLAB variable named ans.',
        distractors: [
          'It is permanently discarded and cannot be referenced.',
          'In the system environment variable PATH.',
          'In a read-only constant named pi.',
        ],
        explanation:
          'MATLAB automatically stores the result of any unassigned expression in the built-in default variable ans.',
        hint: 'Look at Section 1.3 (Use of ans) in Experiment 1.',
      },
      {
        detect: /one-based indexing|A\(row,column\)/i,
        keyword: 'one-based indexing',
        difficulty: 'beginner',
        prompt: 'In MATLAB, if A = [10 20 30 40 50], what value does A(3) access and why?',
        correct: '30, because MATLAB uses 1-based array indexing where the first element is at index 1.',
        distractors: [
          '40, because MATLAB uses 0-based array indexing starting at index 0.',
          '20, because array indices count backwards from the end.',
          'An index error, because vectors cannot be indexed with parentheses.',
        ],
        explanation:
          'MATLAB uses 1-based indexing: A(1) is 10, A(2) is 20, and A(3) is 30.',
        hint: 'Does MATLAB start counting indices at 0 or at 1?',
      },
      {
        detect: /A\(2,:\)\s*selects row 2/i,
        keyword: 'selects row 2',
        difficulty: 'intermediate',
        prompt: 'Given a 3x3 matrix A in MATLAB, what does the expression A(2, :) extract?',
        correct: 'All elements across the entire 2nd row of matrix A.',
        distractors: [
          'All elements down the entire 2nd column of matrix A.',
          'Only the main diagonal elements of matrix A.',
          'The transpose of the first two rows of matrix A.',
        ],
        explanation:
          'In A(row, col), placing a colon (:) in the column position selects all columns for row 2.',
        hint: 'The first index is the row and the second index is the column.',
      },
      {
        detect: /start:step:end|1:2:11/i,
        keyword: 'colon operator',
        difficulty: 'beginner',
        prompt: 'What sequence does the MATLAB colon expression 1:2:11 generate?',
        correct: '[1 3 5 7 9 11]',
        distractors: [
          '[1 2 11]',
          '[2 4 6 8 10]',
          '[1 2 3 4 5 6 7 8 9 10 11]',
        ],
        explanation:
          'In start:step:end, 1:2:11 starts at 1, increments by step 2, and stops at 11: [1 3 5 7 9 11].',
        hint: 'The middle number in start:step:end specifies the step increment.',
      },
      {
        detect: /conv\(x,h\)|L\+M-1/i,
        keyword: 'conv(x,h)',
        difficulty: 'intermediate',
        prompt: 'If two finite discrete sequences have lengths L and M, what is the length of their linear convolution y = conv(x, h)?',
        correct: 'L + M - 1',
        distractors: ['L * M', 'max(L, M)', 'L + M'],
        explanation:
          'For two finite sequences of lengths L and M, linear convolution produces an output sequence of length L + M - 1 (for example, lengths 3 and 3 yield length 5).',
        hint: 'Check Experiment 11: x = [1 2 3] (L=3) and h = [1 1 1] (M=3) produced y = [1 3 6 5 3].',
      },
      {
        detect: /Difference Between Script and Function|own local workspace/i,
        keyword: 'local workspace',
        difficulty: 'intermediate',
        prompt: 'How does a MATLAB user-defined function differ from a MATLAB script file?',
        correct: 'A function uses its own local workspace, accepts input/output arguments, and is saved with a filename matching the function name.',
        distractors: [
          'A function shares the base workspace and cannot accept formal input arguments.',
          'A script requires a function header line, whereas a function cannot be saved as an .m file.',
          'Scripts automatically create local workspaces isolated from the Command Window.',
        ],
        explanation:
          'Scripts run in the base workspace with no formal argument list, while functions run in a local workspace and use input/output arguments.',
        hint: 'Review the comparison table in Experiment 7.',
      },
      {
        detect: /plot\(\).*stem\(\)|discrete-time plot/i,
        keyword: 'stem',
        difficulty: 'intermediate',
        prompt: 'When plotting signals in MATLAB, when should you choose stem() instead of plot()?',
        correct: 'Use stem() for discrete-time sequences (e.g., unit impulse/step samples) and plot() for continuous curves.',
        distractors: [
          'Use stem() only for 3-D wireframe surfaces and plot() only for matrices.',
          'Use stem() to divide a figure window into multiple sub-axes.',
          'Use plot() for discrete stems and stem() to calculate determinants.',
        ],
        explanation:
          'stem() plots discrete sample values with stems and markers, whereas plot() connects points into a continuous 2-D line plot.',
        hint: 'Look at Experiment 9 where unit impulse and unit step signals are plotted.',
      },
      {
        detect: /subplot\(m,n,p\)|subplot\(2,2,1\)/i,
        keyword: 'subplot',
        difficulty: 'intermediate',
        prompt: 'What does calling subplot(2, 2, 3) do in MATLAB?',
        correct: 'Divides the figure into a 2-row by 2-column grid and selects the 3rd axes position for the next plot.',
        distractors: [
          'Draws a 3-D helix using 2-by-2 coordinate matrices.',
          'Plots three overlapping curves on a single set of axes with a legend.',
          'Creates a 2x2 identity matrix multiplied by 3.',
        ],
        explanation:
          'subplot(m, n, p) splits a figure window into an m-by-n grid of subplots and activates the p-th subplot.',
        hint: 'The first two arguments give rows and columns; the third selects the active panel.',
      },
      {
        detect: /meshgrid\(|3-D wireframe surface/i,
        keyword: 'mesh',
        difficulty: 'advanced',
        prompt: 'In Experiment 10, how do meshgrid() and mesh() work together to render a 3-D surface?',
        correct: 'meshgrid() builds 2-D coordinate matrices X and Y over the domain, and mesh(X, Y, Z) plots the 3-D wireframe surface.',
        distractors: [
          'meshgrid() computes the inverse matrix, and mesh() computes linear convolution.',
          'mesh() generates a 1-D vector of integers, and meshgrid() draws discrete stems.',
          'plot3() creates coordinate matrices for meshgrid() to clear the workspace.',
        ],
        explanation:
          'meshgrid(x, y) creates full 2-D coordinate matrices [X, Y] so Z = f(X, Y) can be evaluated and plotted as a 3-D wireframe via mesh(X, Y, Z).',
        hint: 'Check Section 10.3: 3-D Surface Plot Using mesh().',
      },
      {
        detect: /det\(\).*inv\(\)|determinant is non-zero/i,
        keyword: 'inv',
        difficulty: 'intermediate',
        prompt: 'According to your matrix operations notes, when does a square matrix A have a valid inverse inv(A)?',
        correct: 'When A is a square matrix whose determinant det(A) is non-zero.',
        distractors: [
          'Whenever matrix A has more columns than rows.',
          'Only when every element of matrix A is zero.',
          'When det(A) is strictly equal to zero.',
        ],
        explanation:
          'A square matrix is invertible only if its determinant det(A) is non-zero (det(A) ~= 0).',
        hint: 'Review Section 2.7 (Inverse) in Experiment 2.',
      },
      {
        detect: /D=b\^2-4\*a\*c|Quadratic Equation/i,
        keyword: 'quadratic',
        difficulty: 'intermediate',
        prompt: 'In the Quadratic Equation program (D = b^2 - 4*a*c), what happens when the discriminant D is negative (D < 0)?',
        correct: 'The program computes and prints two complex conjugate roots (real part +/- imaginary part).',
        distractors: [
          'The program prints two equal real roots.',
          'The program throws a division-by-zero error and exits.',
          'The equation is treated as linear and D is ignored.',
        ],
        explanation:
          'When D > 0 roots are distinct real numbers, when D == 0 roots are equal real numbers, and when D < 0 roots are complex conjugates rp ± ip*i.',
        hint: 'Check the final else branch in Section 5.4 (Roots of a Quadratic Equation).',
      },
      {
        detect: /all\(marks>=40\)|Student Result Calculator/i,
        keyword: 'Student Result',
        difficulty: 'beginner',
        prompt: 'In the Student Result Calculator program, what condition determines whether "Result: PASS" is printed?',
        correct: 'all(marks >= 40) — every subject must score at least 40 marks.',
        distractors: [
          'sum(marks) >= 40 — the total across all subjects only needs to be 40.',
          'any(marks >= 40) — passing at least one subject is sufficient.',
          'marks(1) >= 40 — only the first subject is checked.',
        ],
        explanation:
          'all(marks >= 40) returns true only when every single element in the marks vector satisfies >= 40.',
        hint: 'Notice MATLAB uses all(...), not any(...).',
      },
      {
        detect: /for loop is generally used when repetitions are known/i,
        keyword: 'loops',
        difficulty: 'beginner',
        prompt: 'What is the main guideline for choosing between a for loop and a while loop in MATLAB?',
        correct: 'Use a for loop when the number of iterations is known beforehand, and a while loop when repetition depends on a condition staying true.',
        distractors: [
          'Use a while loop only for matrices of known size and a for loop only for infinite loops.',
          'A while loop cannot modify loop counter variables inside its body.',
          'A for loop executes only once regardless of the range given.',
        ],
        explanation:
          'A for loop iterates over a fixed sequence/count, whereas a while loop continues executing as long as its condition evaluates to true.',
        hint: 'Review the Theory / Introduction of Experiment 6 (Loops).',
      },
    ];

    for (const tpl of practicalQuestionTemplates) {
      if (drafts.length >= count) break;
      if (!tpl.detect.test(allChunksText)) continue;
      const { topic, refs } = findTopicAndRefs(tpl.keyword);
      const options = shuffleDeterministic(
        [tpl.correct, ...tpl.distractors],
        tpl.prompt + roundNo,
      );
      tryAddDraft({
        topic_id: topic.id,
        type: 'mcq',
        difficulty: (difficulty as 'beginner' | 'intermediate' | 'advanced') || tpl.difficulty,
        round_no: roundNo,
        prompt: tpl.prompt,
        options,
        answer_key: { correct: tpl.correct, keywords: tokenize(tpl.correct).slice(0, 5) },
        rubric: { topic_name: topic.name },
        explanation: tpl.explanation,
        hints: [tpl.hint],
        source_refs: refs,
        question_hash: hashPrompt(tpl.prompt),
      });
    }

    // -------------------------------------------------------------------------
    // 3. Dynamic Command / Operator Purpose MCQs parsed from document text
    // -------------------------------------------------------------------------
    const commandItems: Array<{ command: string; purpose: string; chunk: DocumentChunkRow }> = [];
    const seenCmds = new Set<string>();
    for (const chunk of chunks) {
      for (const line of chunk.content.split('\n')) {
        const parsed = parseCommandPurposeLine(line);
        if (
          parsed &&
          parsed.purpose.length >= 10 &&
          parsed.purpose.length <= 150 &&
          !seenCmds.has(parsed.command.toLowerCase()) &&
          !isAdminOrNoiseText(parsed.command) &&
          !isAdminOrNoiseText(parsed.purpose)
        ) {
          seenCmds.add(parsed.command.toLowerCase());
          commandItems.push({ ...parsed, chunk });
        }
      }
    }

    if (commandItems.length >= 4) {
      for (let i = 0; i < commandItems.length && drafts.length < count; i++) {
        const item = commandItems[(i + roundNo) % commandItems.length];
        const distractors = commandItems
          .filter((other) => other.command !== item.command && other.purpose.toLowerCase() !== item.purpose.toLowerCase())
          .slice(0, 3)
          .map((o) => cleanTruncate(o.purpose, 145));
        if (distractors.length < 3) continue;

        const correctOpt = cleanTruncate(item.purpose, 145);
        const prompt = `What is the purpose of the "${item.command}" command/operator in your study material?`;
        const options = shuffleDeterministic([correctOpt, ...distractors], prompt + roundNo);
        const { topic } = findTopicAndRefs(item.command);

        tryAddDraft({
          topic_id: topic.id,
          type: 'mcq',
          difficulty: (difficulty as 'beginner' | 'intermediate' | 'advanced') || 'intermediate',
          round_no: roundNo,
          prompt,
          options,
          answer_key: { correct: correctOpt, keywords: tokenize(item.command + ' ' + correctOpt).slice(0, 5) },
          rubric: { topic_name: topic.name },
          explanation: `"${item.command}": ${item.purpose}`,
          hints: [`Check the Commands/Operators reference on ${toSourceRef(item.chunk).label}.`],
          source_refs: [toSourceRef(item.chunk)],
          question_hash: hashPrompt(prompt),
        });
      }
    }

    // -------------------------------------------------------------------------
    // 4. Clean Concept Definition MCQs across diverse top-level topics
    // Never pads with garbage distractors — only uses real sibling definitions!
    // -------------------------------------------------------------------------
    const usableDefTopics = validTopics.filter((t) => {
      const def = (t.definition || t.summary || '').trim();
      return (
        def.length >= 24 &&
        def.length <= 260 &&
        !isAdminOrNoiseText(def) &&
        !/Name of Student|Roll No|Academic Session/i.test(def)
      );
    });

    for (let i = 0; i < usableDefTopics.length && drafts.length < count; i++) {
      const topic = usableDefTopics[i];
      const def = (topic.definition || topic.summary || '').trim();
      const correctOpt = cleanTruncate(def, 145);

      const siblingDefs = usableDefTopics
        .filter((other) => other.id !== topic.id)
        .map((other) => cleanTruncate(other.definition || other.summary || '', 145))
        .filter((opt) => opt.toLowerCase() !== correctOpt.toLowerCase() && opt.length >= 18);

      const uniqueSiblingDefs = Array.from(new Set(siblingDefs));
      if (uniqueSiblingDefs.length < 3) continue;

      const distractors = uniqueSiblingDefs.slice(0, 3);
      const options = shuffleDeterministic([correctOpt, ...distractors], topic.id + roundNo);
      const prompt = `Which statement accurately describes "${topic.name}" according to your study material?`;

      tryAddDraft({
        topic_id: topic.id,
        type: 'mcq',
        difficulty: (difficulty as 'beginner' | 'intermediate' | 'advanced') || topic.difficulty,
        round_no: roundNo,
        prompt,
        options,
        answer_key: { correct: correctOpt, keywords: tokenize(topic.name + ' ' + def).slice(0, 6) },
        rubric: { topic_name: topic.name, grounded_chunk_ids: topic.source_refs.map((r) => r.chunk_id) },
        explanation: def,
        hints: [
          `Review ${topic.source_refs[0]?.label || 'your notes'} under "${topic.name}".`,
          `Focus on key concepts: ${tokenize(def).slice(0, 3).join(', ')}.`,
        ],
        source_refs: topic.source_refs,
        question_hash: hashPrompt(prompt + topic.id),
      });
    }

    // -------------------------------------------------------------------------
    // 5. Clean Declarative True/False from Theory sentences (if still < count)
    // -------------------------------------------------------------------------
    const cleanSentences: Array<{ sent: string; chunk: DocumentChunkRow; topic: TopicRow }> = [];
    for (const chunk of chunks) {
      const matchedTopic =
        validTopics.find((t) => t.source_refs.some((r) => r.chunk_id === chunk.id)) || validTopics[0];
      for (const sent of splitSentences(chunk.content)) {
        if (
          sent.length >= 35 &&
          sent.length <= 185 &&
          !/Sample Output:|MATLAB Program:|fprintf\(|disp\(|clc;|RESULT:/i.test(sent) &&
          !isAdminOrNoiseText(sent)
        ) {
          cleanSentences.push({ sent, chunk, topic: matchedTopic });
        }
      }
    }

    for (let idx = 0; idx < cleanSentences.length && drafts.length < count; idx++) {
      const { sent, chunk, topic } = cleanSentences[idx];
      const shouldNegate = idx % 2 === 1;
      const statement = shouldNegate ? negateSentence(sent) : sent;
      if (!statement || statement.length > 200) continue;

      const prompt = `True or False: ${statement}`;
      tryAddDraft({
        topic_id: topic.id,
        type: 'true_false',
        difficulty: 'beginner',
        round_no: roundNo,
        prompt,
        options: ['True', 'False'],
        answer_key: { correct: shouldNegate ? 'False' : 'True', keywords: tokenize(sent).slice(0, 4) },
        rubric: { original_sentence: sent },
        explanation: shouldNegate
          ? `False. Your material states: "${sent}"`
          : `True. This directly matches ${toSourceRef(chunk).label}.`,
        hints: [`Check ${toSourceRef(chunk).label} carefully.`],
        source_refs: [toSourceRef(chunk)],
        question_hash: hashPrompt(prompt),
      });
    }

    return drafts.slice(0, count);
  },

  async evaluateAnswer({ question, studentAnswer }): Promise<EvaluationOutput> {
    const cleanStudent = studentAnswer.trim();
    const expected = String(question.answer_key.correct || '').trim();

    if (question.type === 'mcq' || question.type === 'true_false') {
      const isCorrect = cleanStudent.toLowerCase() === expected.toLowerCase();
      return {
        is_correct: isCorrect,
        score: isCorrect ? 1 : 0,
        grading_method: 'deterministic',
        feedback: isCorrect
          ? 'Correct! Well matched to the study material.'
          : 'Not quite — review the explanation and source reference below.',
        correct_answer: expected,
        explanation: question.explanation,
      };
    }

    const keywords = (question.answer_key.keywords || tokenize(expected)).map((k) => k.toLowerCase());
    const studentTokens = new Set(tokenize(cleanStudent));
    const lowerStudent = cleanStudent.toLowerCase();

    let contradictionPenalty = 0;
    if (keywords.includes('lifo') && lowerStudent.includes('fifo')) contradictionPenalty = 0.5;
    if (keywords.includes('fifo') && lowerStudent.includes('lifo')) contradictionPenalty = 0.5;

    const matched = keywords.filter((kw) => lowerStudent.includes(kw) || studentTokens.has(kw));
    const ratio = keywords.length > 0 ? matched.length / Math.min(4, keywords.length) : 0;
    const rawScore = Math.max(0, Math.min(1, Number((ratio - contradictionPenalty).toFixed(2))));
    const isCorrect = rawScore >= 0.7;

    return {
      is_correct: isCorrect,
      score: rawScore,
      grading_method: 'deterministic',
      feedback: isCorrect
        ? 'Strong explanation covering the core concepts.'
        : rawScore >= 0.35
          ? 'Partially correct, but missing key details from your material.'
          : 'Your answer missed the key concept or inverted the expected behavior.',
      correct_answer: expected,
      explanation: question.explanation,
    };
  },

  async diagnoseMisconception({
    question,
    studentAnswer,
    topic,
    allUserTopics,
    topicChunks,
    priorTopicScore,
  }): Promise<MisconceptionDiagnosisOutput> {
    const expected = String(question.answer_key.correct || '');
    const lowerAns = studentAnswer.toLowerCase();
    const lowerExpected = (expected + ' ' + question.prompt).toLowerCase();
    const topicName = topic?.name || 'Core Concept';
    const topicId = topic?.id || null;

    // 1. Check predefined cognitive inversion patterns
    for (const pattern of KNOWN_MISCONCEPTION_PAIRS) {
      const expectsPattern = pattern.expectedTerms.some((t) => lowerExpected.includes(t));
      const answeredConfused = pattern.confusedTerms.some((t) => lowerAns.includes(t));
      if (expectsPattern && answeredConfused) {
        const followUp = buildCorrectiveFollowUp(topicId, topicName, expected, pattern.key, topicChunks);
        return {
          cause_class: 'misconception',
          misconception_key: pattern.key,
          label: pattern.label,
          concept: topicName,
          confidence: 0.88,
          explanation: pattern.explanation,
          recommended_action: 'Complete the targeted corrective mini-lesson and follow-up check.',
          corrective_lesson: `### Corrective Mini-Lesson: ${pattern.label}\n\n${pattern.explanation}\n\n**How to remember it:** ${pattern.correctiveTip}\n\n**Grounded in your notes:**\n> ${cleanTruncate(topicChunks[0]?.content || expected, 240)}`,
          follow_up_question: followUp,
          model: this.modelName,
        };
      }
    }

    // 2. Check cross-concept confusion against sibling topics in user's own document
    const confusedSibling = allUserTopics.find(
      (other) =>
        other.id !== topicId &&
        other.definition &&
        !isAdminOrNoiseText(other.name) &&
        (lowerAns.includes(other.name.toLowerCase()) ||
          tokenize(other.definition).filter((w) => lowerAns.includes(w)).length >= 3),
    );

    if (confusedSibling) {
      const mKey = `confusion_${slugify(topicName)}_vs_${slugify(confusedSibling.name)}`;
      const label = `Confusing ${topicName} with ${confusedSibling.name}`;
      const explanation = `Your response aligns more closely with "${confusedSibling.name}" than "${topicName}".`;
      const followUp = buildCorrectiveFollowUp(topicId, topicName, expected, mKey, topicChunks);
      return {
        cause_class: 'misconception',
        misconception_key: mKey,
        label,
        concept: topicName,
        confidence: 0.78,
        explanation,
        recommended_action: `Compare ${topicName} and ${confusedSibling.name} side-by-side, then answer the verification question.`,
        corrective_lesson: `### Concept Distinction: ${topicName} vs ${confusedSibling.name}\n\n- **${topicName}:** ${topic?.definition || expected}\n- **${confusedSibling.name}:** ${confusedSibling.definition}\n\nMake sure not to swap their behaviors or rules.`,
        follow_up_question: followUp,
        model: this.modelName,
      };
    }

    // 3. Check Careless Slip vs Knowledge Gap
    const causeClass: CauseClass = priorTopicScore >= 75 ? 'careless_slip' : 'knowledge_gap';
    const mKey = `${causeClass}_${slugify(topicName)}`;
    const label =
      causeClass === 'careless_slip'
        ? `Possible Careless Slip on ${topicName}`
        : `Knowledge Gap in ${topicName}`;
    const explanation =
      causeClass === 'careless_slip'
        ? `You already show strong mastery (${priorTopicScore}%) in ${topicName}, suggesting a quick slip rather than a fundamental misconception.`
        : `Your answer did not match the core rule for ${topicName}. Reviewing the source section will fill this gap.`;
    const followUp = buildCorrectiveFollowUp(topicId, topicName, expected, mKey, topicChunks);

    return {
      cause_class: causeClass,
      misconception_key: mKey,
      label,
      concept: topicName,
      confidence: causeClass === 'careless_slip' ? 0.65 : 0.72,
      explanation,
      recommended_action: `Review ${topicName} in your study material and retry the quick check.`,
      corrective_lesson: `### Quick Review: ${topicName}\n\n**Expected Rule:** ${expected}\n\n**From your study material:**\n> ${cleanTruncate(topicChunks[0]?.content || expected, 240)}`,
      follow_up_question: followUp,
      model: this.modelName,
    };
  },

  async generateQuestLesson({ topic, chunks, style }): Promise<string> {
    const refLabel = topic.source_refs[0]?.label || 'Study Material';
    const relevantExcerpts = chunks
      .filter((c) => topic.source_refs.some((r) => r.chunk_id === c.id))
      .map((c) => c.content)
      .join('\n\n');
    const body = relevantExcerpts || topic.summary || topic.definition || '';

    return [
      `# ${topic.name}`,
      `*Grounded in ${refLabel} · Engine: Rule-Based Engine · Style: ${style.replace(/_/g, ' ')}*`,
      '',
      topic.definition ? `## Core Principle\n${topic.definition}` : '',
      topic.formulas.length > 0
        ? `## Key Syntax & Formulas\n${topic.formulas.map((f) => `- \`${f}\``).join('\n')}`
        : '',
      topic.examples.length > 0
        ? `## Examples from Your Notes\n${topic.examples.map((e) => `- ${e}`).join('\n')}`
        : '',
      `## Grounded Study Excerpt\n${body.slice(0, 1200)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  },
};

function buildCorrectiveFollowUp(
  topicId: string | null,
  topicName: string,
  expected: string,
  misconceptionKey: string,
  chunks: DocumentChunkRow[],
): GeneratedQuestionDraft {
  const prompt = `Verification Check (${topicName}): Which statement accurately reflects the correct rule?`;
  const correct = cleanTruncate(expected, 148);
  const wrong1 = misconceptionKey.includes('stack_lifo_vs_fifo')
    ? 'Removes the oldest item from the bottom/front (FIFO behavior).'
    : misconceptionKey.includes('elementwise')
      ? 'Applies matrix multiplication rules regardless of element positions.'
      : 'Applies the exact opposite ordering or indexing rule.';
  const wrong2 = 'Processes or modifies elements in arbitrary unsorted order.';
  const wrong3 = 'Skips evaluation completely and leaves workspace values unchanged.';
  const options = shuffleDeterministic([correct, wrong1, wrong2, wrong3], prompt + misconceptionKey);

  return {
    topic_id: topicId,
    type: 'mcq',
    difficulty: 'intermediate',
    round_no: 1,
    prompt,
    options,
    answer_key: { correct, keywords: tokenize(expected).slice(0, 4) },
    rubric: { verifies_misconception: misconceptionKey },
    explanation: expected,
    hints: [`Remember the distinction explained in the corrective mini-lesson above.`],
    source_refs: chunks[0] ? [toSourceRef(chunks[0])] : [],
    question_hash: hashPrompt(prompt + misconceptionKey + Date.now()),
  };
}

function extractSectionTitle(text: string, fallback: string): string {
  const firstLine = text.split('\n')[0]?.trim() || '';
  if (
    firstLine.length >= 4 &&
    firstLine.length <= 65 &&
    !firstLine.endsWith('.') &&
    !isAdminOrNoiseText(firstLine)
  ) {
    return firstLine.replace(/^#+\s*/, '');
  }
  const words = tokenize(text).slice(0, 4);
  if (words.length > 0) {
    return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return fallback;
}

function extractConceptsFromChunks(
  chunks: DocumentChunkRow[],
): Array<{ name: string; explanation: string; chunk: DocumentChunkRow }> {
  const results: Array<{ name: string; explanation: string; chunk: DocumentChunkRow }> = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const lines = chunk.content.split('\n');
    for (const line of lines) {
      if (isAdminOrNoiseLine(line)) continue;
      const m = line.match(/^(?:[-*•]\s*)?([A-Z][A-Za-z0-9\s/()\-]{2,36})\s*[:\-–]\s+(.{18,220})$/);
      if (m) {
        const name = m[1].trim();
        const explanation = m[2].trim();
        if (isAdminOrNoiseText(name) || isAdminOrNoiseText(explanation)) continue;
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name, explanation, chunk });
        }
      }
    }
  }
  return results;
}

function negateSentence(sentence: string): string | null {
  if (/\bis not\b/i.test(sentence)) return sentence.replace(/\bis not\b/i, 'is');
  if (/\bare not\b/i.test(sentence)) return sentence.replace(/\bare not\b/i, 'are');
  if (/\bLIFO\b/.test(sentence)) return sentence.replace(/\bLIFO\b/, 'FIFO');
  if (/\bFIFO\b/.test(sentence)) return sentence.replace(/\bFIFO\b/, 'LIFO');
  if (/\btop\b/i.test(sentence)) return sentence.replace(/\btop\b/i, 'bottom');
  if (/\bis\b/i.test(sentence)) return sentence.replace(/\bis\b/i, 'is NEVER');
  if (/\bare\b/i.test(sentence)) return sentence.replace(/\bare\b/i, 'are NEVER');
  return null;
}

function shuffleDeterministic<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
