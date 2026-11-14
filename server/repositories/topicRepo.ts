import { getDb } from '../core/database.ts';

export interface SourceRef {
  kind: 'page' | 'slide' | 'section';
  number: number;
  label: string;
  chunk_id?: string;
}

export interface TopicRow {
  id: string;
  user_id: string;
  document_id: string;
  subject_id: string | null;
  parent_id: string | null;
  kind: 'topic' | 'subtopic' | 'concept';
  name: string;
  slug: string;
  summary: string;
  definition: string | null;
  formulas: string[];
  examples: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  source_refs: SourceRef[];
  grounded: boolean;
  order_index: number;
}

export interface TopicRelationRow {
  id: string;
  user_id: string;
  from_topic_id: string;
  to_topic_id: string;
  relation: 'prerequisite_of' | 'part_of' | 'related_to' | 'contrasts_with';
  source_refs: SourceRef[];
}

export interface TopicMasteryRow {
  id: string;
  user_id: string;
  topic_id: string | null;
  topic_name_snapshot: string;
  score: number;
  confidence: number;
  band: 'unassessed' | 'weak' | 'needs_practice' | 'developing' | 'strong';
  evidence_count: number;
  correct_count: number;
  last_practiced_at: string | null;
  next_review_at: string | null;
  breakdown: Record<string, unknown>;
  updated_at: string;
}

function hydrateTopic(raw: Record<string, unknown>): TopicRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    document_id: String(raw.document_id),
    subject_id: raw.subject_id ? String(raw.subject_id) : null,
    parent_id: raw.parent_id ? String(raw.parent_id) : null,
    kind: raw.kind as TopicRow['kind'],
    name: String(raw.name),
    slug: String(raw.slug),
    summary: String(raw.summary),
    definition: raw.definition ? String(raw.definition) : null,
    formulas: JSON.parse(String(raw.formulas || '[]')),
    examples: JSON.parse(String(raw.examples || '[]')),
    difficulty: raw.difficulty as TopicRow['difficulty'],
    source_refs: JSON.parse(String(raw.source_refs || '[]')),
    grounded: Boolean(raw.grounded),
    order_index: Number(raw.order_index || 0),
  };
}

export const topicRepo = {
  replaceDocumentTopics(
    userId: string,
    documentId: string,
    topics: TopicRow[],
    relations: TopicRelationRow[],
  ): void {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM topic_relations WHERE user_id = ? AND from_topic_id IN (SELECT id FROM topics WHERE document_id = ? AND user_id = ?)').run(
        userId,
        documentId,
        userId,
      );
      db.prepare('DELETE FROM topics WHERE document_id = ? AND user_id = ?').run(documentId, userId);

      const topicStmt = db.prepare(
        `INSERT INTO topics
         (id, user_id, document_id, subject_id, parent_id, kind, name, slug, summary, definition, formulas, examples, difficulty, source_refs, grounded, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const t of topics) {
        topicStmt.run(
          t.id,
          userId,
          documentId,
          t.subject_id,
          t.parent_id,
          t.kind,
          t.name,
          t.slug,
          t.summary,
          t.definition,
          JSON.stringify(t.formulas),
          JSON.stringify(t.examples),
          t.difficulty,
          JSON.stringify(t.source_refs),
          t.grounded ? 1 : 0,
          t.order_index,
        );
      }

      const relStmt = db.prepare(
        `INSERT OR IGNORE INTO topic_relations (id, user_id, from_topic_id, to_topic_id, relation, source_refs)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of relations) {
        relStmt.run(
          r.id,
          userId,
          r.from_topic_id,
          r.to_topic_id,
          r.relation,
          JSON.stringify(r.source_refs),
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  listTopics(userId: string, filters?: { documentId?: string; subjectId?: string }): TopicRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM topics WHERE user_id = ?';
    const args: string[] = [userId];
    if (filters?.documentId) {
      sql += ' AND document_id = ?';
      args.push(filters.documentId);
    }
    if (filters?.subjectId) {
      sql += ' AND subject_id = ?';
      args.push(filters.subjectId);
    }
    sql += ' ORDER BY order_index ASC';
    const rows = db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    return rows.map(hydrateTopic);
  },

  getTopic(userId: string, topicId: string): TopicRow | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM topics WHERE id = ? AND user_id = ?')
      .get(topicId, userId) as Record<string, unknown> | undefined;
    return row ? hydrateTopic(row) : undefined;
  },

  listRelationsForTopic(userId: string, topicId: string): TopicRelationRow[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM topic_relations
         WHERE user_id = ? AND (from_topic_id = ? OR to_topic_id = ?)`,
      )
      .all(userId, topicId, topicId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      from_topic_id: String(r.from_topic_id),
      to_topic_id: String(r.to_topic_id),
      relation: r.relation as TopicRelationRow['relation'],
      source_refs: JSON.parse(String(r.source_refs || '[]')),
    }));
  },

  listMastery(userId: string): TopicMasteryRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM topic_mastery WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      topic_id: r.topic_id ? String(r.topic_id) : null,
      topic_name_snapshot: String(r.topic_name_snapshot || ''),
      score: Number(r.score),
      confidence: Number(r.confidence),
      band: r.band as TopicMasteryRow['band'],
      evidence_count: Number(r.evidence_count),
      correct_count: Number(r.correct_count),
      last_practiced_at: r.last_practiced_at ? String(r.last_practiced_at) : null,
      next_review_at: r.next_review_at ? String(r.next_review_at) : null,
      breakdown: JSON.parse(String(r.breakdown || '{}')),
      updated_at: String(r.updated_at),
    }));
  },

  getMasteryForTopic(userId: string, topicId: string): TopicMasteryRow | undefined {
    const db = getDb();
    const r = db
      .prepare('SELECT * FROM topic_mastery WHERE user_id = ? AND topic_id = ?')
      .get(userId, topicId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: String(r.id),
      user_id: String(r.user_id),
      topic_id: r.topic_id ? String(r.topic_id) : null,
      topic_name_snapshot: String(r.topic_name_snapshot || ''),
      score: Number(r.score),
      confidence: Number(r.confidence),
      band: r.band as TopicMasteryRow['band'],
      evidence_count: Number(r.evidence_count),
      correct_count: Number(r.correct_count),
      last_practiced_at: r.last_practiced_at ? String(r.last_practiced_at) : null,
      next_review_at: r.next_review_at ? String(r.next_review_at) : null,
      breakdown: JSON.parse(String(r.breakdown || '{}')),
      updated_at: String(r.updated_at),
    };
  },

  upsertMastery(row: TopicMasteryRow): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO topic_mastery
       (id, user_id, topic_id, topic_name_snapshot, score, confidence, band, evidence_count, correct_count, last_practiced_at, next_review_at, breakdown, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, topic_id) DO UPDATE SET
         topic_name_snapshot = excluded.topic_name_snapshot,
         score = excluded.score,
         confidence = excluded.confidence,
         band = excluded.band,
         evidence_count = excluded.evidence_count,
         correct_count = excluded.correct_count,
         last_practiced_at = excluded.last_practiced_at,
         next_review_at = excluded.next_review_at,
         breakdown = excluded.breakdown,
         updated_at = datetime('now')`,
    ).run(
      row.id,
      row.user_id,
      row.topic_id,
      row.topic_name_snapshot,
      row.score,
      row.confidence,
      row.band,
      row.evidence_count,
      row.correct_count,
      row.last_practiced_at,
      row.next_review_at,
      JSON.stringify(row.breakdown),
    );
  },
};
