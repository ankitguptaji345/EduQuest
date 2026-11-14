import crypto from 'node:crypto';
import type { DocumentChunkRow } from '../../repositories/documentRepo.ts';
import type { QuestionSecret } from '../../repositories/assessmentRepo.ts';
import type { CauseClass } from '../../repositories/misconceptionRepo.ts';
import type { SourceRef, TopicRow } from '../../repositories/topicRepo.ts';
import type { TutorCitation, TutorMessageRow } from '../../repositories/tutorRepo.ts';
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
    .filter((s) => s.length > 20);
}

function toSourceRef(chunk: DocumentChunkRow): SourceRef {
  const prefix =
    chunk.source_kind === 'page' ? 'Page' : chunk.source_kind === 'slide' ? 'Slide' : 'Section';
  const label = chunk.heading_path || `${prefix} ${chunk.source_start}`;
  return {
    kind: chunk.source_kind,
    number: chunk.source_start,
    label,
    chunk_id: chunk.id,
  };
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

    // Normalize into a meaningful 0..1+ relevance score
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
];

export const ruleBasedProvider: AIProvider = {
  id: 'rule_based',
  label: 'Rule-Based Engine',
  modelName: 'rule-based-v1',

  async analyzeDocument({ documentTitle, chunks }): Promise<DocumentAnalysisOutput> {
    const allText = chunks.map((c) => c.content).join('\n\n');
    const allSentences = splitSentences(allText);

    // Group chunks by heading_path or unit label
    const groupMap = new Map<string, DocumentChunkRow[]>();
    for (const chunk of chunks) {
      const key = (chunk.heading_path || `Section ${chunk.source_start}`).trim();
      const arr = groupMap.get(key) || [];
      arr.push(chunk);
      groupMap.set(key, arr);
    }

    const topics: AnalyzedTopicDraft[] = [];
    const relations: AnalyzedRelationDraft[] = [];
    const usedSlugs = new Set<string>();
    const makeUniqueSlug = (name: string) => {
      let base = slugify(name);
      let s = base;
      let i = 2;
      while (usedSlugs.has(s)) {
        s = `${base}-${i++}`;
      }
      usedSlugs.add(s);
      return s;
    };

    // Extract topics from grouped sections
    let orderIdx = 0;
    const parentTopics: AnalyzedTopicDraft[] = [];

    for (const [heading, groupChunks] of groupMap.entries()) {
      const combined = groupChunks.map((c) => c.content).join(' ');
      const sentences = splitSentences(combined);

      // Clean heading title
      const cleanName = heading.replace(/^Page \d+$/i, '').trim() ||
        extractSectionTitle(combined, `Section ${groupChunks[0].source_start}`);

      // Extract definitions, formulas, examples strictly from chunk text
      const definitions = sentences.filter((s) =>
        /\b(is defined as|refers to|is a |are |means |consists of|follows the)\b/i.test(s),
      );
      const formulas = combined
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 3 && l.length < 120 && (/[=<>→]|O\([^)]+\)/i.test(l)))
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
        summary: sentences.slice(0, 2).join(' ') || combined.slice(0, 220),
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

      // Extract distinct concept sub-items within the section (e.g., "Term: explanation" or bold/capitalized terms)
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

    // Add sequential prerequisite_of and contrasts_with relations among top-level topics
    for (let i = 0; i < parentTopics.length - 1; i++) {
      relations.push({
        id: crypto.randomUUID(),
        from_topic_id: parentTopics[i].id,
        to_topic_id: parentTopics[i + 1].id,
        relation: 'prerequisite_of',
        source_refs: parentTopics[i].source_refs.slice(0, 1),
      });
    }

    // Detect contrasting pairs (e.g., Stack vs Queue, BFS vs DFS)
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

    const summarySentences = allSentences.slice(0, 3).join(' ');
    const summary =
      summarySentences ||
      `Extracted ${chunks.length} sections from "${documentTitle}" covering ${parentTopics.map((t) => t.name).join(', ')}.`;

    const learningObjectives = parentTopics
      .slice(0, 5)
      .map((t) => `Understand and apply the core principles of ${t.name}.`);

    const examQuestions = topics.slice(0, 4).map((t) => ({
      prompt: `Explain ${t.name} and identify how it differs from related concepts in this material.`,
      topic: t.name,
      difficulty: t.difficulty,
    }));

    return {
      summary,
      learningObjectives,
      examQuestions,
      topics,
      relations,
      model: this.modelName,
      promptVersion: 'rule-based-v1',
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

    const matchedTopics = topics.filter((t) =>
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
    const drafts: GeneratedQuestionDraft[] = [];
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));
    const poolTopics = topics.length > 0 ? topics : [];

    const makeUnique = (draft: GeneratedQuestionDraft): boolean => {
      if (excludedHashes.has(draft.question_hash)) return false;
      excludedHashes.add(draft.question_hash);
      drafts.push(draft);
      return true;
    };

    // 1. Generate grounded questions from topics & definitions
    for (let i = 0; i < poolTopics.length && drafts.length < count; i++) {
      const topic = poolTopics[i];
      const def = topic.definition || topic.summary;
      if (!def || def.length < 18) continue;

      const siblingTopics = poolTopics.filter((t) => t.id !== topic.id && t.definition);
      const distractors = siblingTopics
        .slice(0, 3)
        .map((s) => truncateOption(s.definition || s.summary));

      while (distractors.length < 3) {
        distractors.push(
          distractors.length === 0
            ? `It operates strictly in reverse order of what ${topic.name} specifies.`
            : distractors.length === 1
              ? `It requires linear scanning O(n) for every constant-time operation.`
              : `None of the principles described in ${topic.name} apply.`,
        );
      }

      const correctOpt = truncateOption(def);
      const options = shuffleDeterministic([correctOpt, ...distractors.slice(0, 3)], topic.id + roundNo);
      const prompt = `Which statement accurately describes "${topic.name}" according to your study material?`;
      const qHash = hashPrompt(prompt + topic.id);

      makeUnique({
        topic_id: topic.id,
        type: 'mcq',
        difficulty: (difficulty as 'beginner' | 'intermediate' | 'advanced') || topic.difficulty,
        round_no: roundNo,
        prompt,
        options,
        answer_key: { correct: correctOpt, keywords: tokenize(topic.name + ' ' + def).slice(0, 6) },
        rubric: { topic_name: topic.name, grounded_chunk_ids: topic.source_refs.map((r) => r.chunk_id) },
        explanation: `${def}`,
        hints: [
          `Review ${topic.source_refs[0]?.label || 'your notes'} under "${topic.name}".`,
          `Focus on the key terms: ${tokenize(def).slice(0, 3).join(', ')}.`,
        ],
        source_refs: topic.source_refs,
        question_hash: qHash,
      });

      if (drafts.length >= count) break;

      // Also generate a second question on contrasting behavior (crucial for 2-error misconception detection!)
      const lowerAll = (topic.name + ' ' + def).toLowerCase();
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
        makeUnique({
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
        makeUnique({
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

    // 2. Fill remaining slots with True/False & Short Answer from chunk sentences
    const allSentences: Array<{ sent: string; chunk: DocumentChunkRow; topic: TopicRow | undefined }> = [];
    for (const chunk of chunks) {
      const matchedTopic = poolTopics.find((t) =>
        t.source_refs.some((r) => r.chunk_id === chunk.id),
      ) || poolTopics[0];
      for (const sent of splitSentences(chunk.content)) {
        if (sent.length >= 35 && sent.length <= 220) {
          allSentences.push({ sent, chunk, topic: matchedTopic });
        }
      }
    }

    for (let idx = 0; idx < allSentences.length && drafts.length < count; idx++) {
      const { sent, chunk, topic } = allSentences[idx];
      const useShortAnswer = drafts.length % 3 === 2;

      if (useShortAnswer) {
        const keywords = tokenize(sent).slice(0, 5);
        const targetName = topic?.name || chunk.heading_path || 'this concept';
        const prompt = `In your own words, explain the key principle of ${targetName} referenced in ${toSourceRef(chunk).label}.`;
        const qHash = hashPrompt(prompt + idx);
        makeUnique({
          topic_id: topic?.id || null,
          type: 'short_answer',
          difficulty: 'intermediate',
          round_no: roundNo,
          prompt,
          options: [],
          answer_key: { correct: sent, keywords },
          rubric: { required_keywords: keywords },
          explanation: `Grounded statement from ${toSourceRef(chunk).label}: "${sent}"`,
          hints: [`Include key terms such as: ${keywords.slice(0, 3).join(', ')}.`],
          source_refs: [toSourceRef(chunk)],
          question_hash: qHash,
        });
      } else {
        const shouldNegate = idx % 2 === 1;
        const statement = shouldNegate ? negateSentence(sent) : sent;
        if (!statement) continue;
        const prompt = `True or False: ${statement}`;
        const qHash = hashPrompt(prompt);
        makeUnique({
          topic_id: topic?.id || null,
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
          question_hash: qHash,
        });
      }
    }

    // 3. Fallback guaranteed variations if count still not reached (e.g. short document)
    let pass = 1;
    while (drafts.length < count && poolTopics.length > 0) {
      const topic = poolTopics[drafts.length % poolTopics.length];
      const chunk = topic.source_refs[0]?.chunk_id
        ? chunkMap.get(topic.source_refs[0].chunk_id)
        : chunks[0];
      const prompt = `[Review #${pass}] Which core concept belongs to "${topic.name}"?`;
      const correct = truncateOption(topic.definition || topic.summary || topic.name);
      const promptHash = hashPrompt(prompt + pass + drafts.length);
      const added = makeUnique({
        topic_id: topic.id,
        type: 'mcq',
        difficulty: topic.difficulty,
        round_no: roundNo,
        prompt,
        options: shuffleDeterministic(
          [
            correct,
            'Unrelated external sorting algorithm requiring quadratic passes.',
            'Manual memory deallocation without reference tracking.',
            'None of the above.',
          ],
          promptHash,
        ),
        answer_key: { correct, keywords: tokenize(topic.name) },
        rubric: {},
        explanation: topic.definition || topic.summary,
        hints: [`Revisit ${topic.name} in ${chunk ? toSourceRef(chunk).label : 'your document'}.`],
        source_refs: topic.source_refs,
        question_hash: promptHash,
      });
      if (!added) pass += 1;
      if (pass > 25) break;
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

    // Short answer / conceptual / code_output: keyword & token overlap with partial credit
    const keywords = (question.answer_key.keywords || tokenize(expected)).map((k) => k.toLowerCase());
    const studentTokens = new Set(tokenize(cleanStudent));
    const lowerStudent = cleanStudent.toLowerCase();

    // Check for explicit contradiction (e.g. FIFO when expecting LIFO)
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

    // 1. Check predefined cognitive inversion patterns (e.g. Stack LIFO vs Queue FIFO)
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
          corrective_lesson: `### Corrective Mini-Lesson: ${pattern.label}\n\n${pattern.explanation}\n\n**How to remember it:** ${pattern.correctiveTip}\n\n**Grounded in your notes:**\n> ${topicChunks[0]?.content.slice(0, 260) || expected}`,
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
        : `Your answer did not include the core rule for ${topicName}. Reviewing the source section will fill this gap.`;
    const followUp = buildCorrectiveFollowUp(topicId, topicName, expected, mKey, topicChunks);

    return {
      cause_class: causeClass,
      misconception_key: mKey,
      label,
      concept: topicName,
      confidence: causeClass === 'careless_slip' ? 0.65 : 0.72,
      explanation,
      recommended_action: `Review ${topicName} in your study material and retry the quick check.`,
      corrective_lesson: `### Quick Review: ${topicName}\n\n**Expected Concept:** ${expected}\n\n**From your study material:**\n> ${topicChunks[0]?.content.slice(0, 280) || expected}`,
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
      topic.definition ? `## Core Definition\n${topic.definition}` : '',
      topic.formulas.length > 0
        ? `## Key Formulas & Rules\n${topic.formulas.map((f) => `- \`${f}\``).join('\n')}`
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
  const correct = truncateOption(expected);
  const wrong1 =
    misconceptionKey.includes('stack_lifo_vs_fifo')
      ? 'Removes the oldest item from the bottom (FIFO behavior).'
      : 'Applies the exact opposite ordering rule.';
  const wrong2 = 'Processes elements in arbitrary unsorted order.';
  const options = shuffleDeterministic([correct, wrong1, wrong2], prompt + misconceptionKey);

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
  if (firstLine.length >= 4 && firstLine.length <= 65 && !firstLine.endsWith('.')) {
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
      const m = line.match(/^(?:[-*•]\s*)?([A-Z][A-Za-z0-9\s/()\-]{2,36})\s*[:\-–]\s+(.{18,220})$/);
      if (m) {
        const name = m[1].trim();
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name, explanation: m[2].trim(), chunk });
        }
      }
    }
  }
  return results;
}

function truncateOption(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 150 ? clean.slice(0, 147) + '...' : clean;
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
