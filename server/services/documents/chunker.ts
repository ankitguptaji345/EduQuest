import crypto from 'node:crypto';
import type { ExtractedUnit } from './extractors.ts';

export interface ChunkDraft {
  id: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  sourceKind: 'page' | 'slide' | 'section';
  sourceStart: number;
  sourceEnd: number;
  headingPath: string;
}

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

export function chunkExtractedUnits(
  units: ExtractedUnit[],
  targetWords = 260,
  overlapWords = 45,
): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let chunkIndex = 0;

  for (const unit of units) {
    const words = unit.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length <= targetWords) {
      chunks.push({
        id: crypto.randomUUID(),
        chunkIndex,
        content: unit.text,
        tokenEstimate: estimateTokens(unit.text),
        sourceKind: unit.kind,
        sourceStart: unit.number,
        sourceEnd: unit.number,
        headingPath: unit.label,
      });
      chunkIndex += 1;
      continue;
    }

    let start = 0;
    while (start < words.length) {
      const end = Math.min(words.length, start + targetWords);
      const slice = words.slice(start, end).join(' ');
      chunks.push({
        id: crypto.randomUUID(),
        chunkIndex,
        content: slice,
        tokenEstimate: estimateTokens(slice),
        sourceKind: unit.kind,
        sourceStart: unit.number,
        sourceEnd: unit.number,
        headingPath: unit.label,
      });
      chunkIndex += 1;
      if (end >= words.length) break;
      start = Math.max(start + 1, end - overlapWords);
    }
  }

  return chunks;
}
