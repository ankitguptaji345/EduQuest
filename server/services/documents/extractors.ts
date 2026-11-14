import JSZip from 'jszip';
import { config } from '../../core/config.ts';
import type { AllowedExt } from './validator.ts';

export interface ExtractedUnit {
  kind: 'page' | 'slide' | 'section';
  number: number;
  label: string;
  headingPath: string;
  text: string;
}

export interface ExtractionResult {
  units: ExtractedUnit[];
  pageCount: number;
  totalChars: number;
  ocrUsed: boolean;
}

export class DocumentExtractionError extends Error {
  public readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const units: ExtractedUnit[] = [];
  let totalChars = 0;

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let lastY: number | null = null;
    let currentLine = '';

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = item.str;
      } else {
        currentLine += (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      }
      lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines.join('\n').trim();
    totalChars += pageText.length;
    if (pageText) {
      units.push({
        kind: 'page',
        number: p,
        label: `Page ${p}`,
        headingPath: `Page ${p}`,
        text: pageText,
      });
    }
  }

  const avgCharsPerPage = numPages > 0 ? totalChars / numPages : 0;
  if (numPages > 0 && avgCharsPerPage < 30) {
    if (!config.ocrEnabled) {
      throw new DocumentExtractionError(
        'SCANNED_PDF_OCR_DISABLED',
        'This PDF contains little or no extractable text (likely a scanned or image-only PDF). OCR is disabled in this environment (SCANNED_PDF_OCR_DISABLED).',
      );
    }
    // Layer B Gemini Vision OCR would run here when OCR_ENABLED=true
  }

  if (totalChars < 15 || units.length === 0) {
    throw new DocumentExtractionError(
      'EMPTY_DOCUMENT',
      'No readable text could be extracted from this PDF document.',
    );
  }

  return { units, pageCount: numPages, totalChars, ocrUsed: false };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) {
    throw new DocumentExtractionError('CORRUPT_FILE', 'Missing word/document.xml inside DOCX.');
  }
  const xml = await xmlFile.async('string');

  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const headingStack: string[] = [];
  const sections: Array<{ headingPath: string; lines: string[] }> = [];
  let currentSection = { headingPath: 'Introduction', lines: [] as string[] };

  for (const pXml of paragraphs) {
    const styleMatch = pXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);
    const style = styleMatch?.[1] || '';
    const textMatches = Array.from(pXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)).map((m) =>
      decodeXmlEntities(m[1]),
    );
    const line = textMatches.join('').trim();
    if (!line) continue;

    const headingMatch = style.match(/^Heading(\d)$/i);
    if (headingMatch) {
      const level = Math.max(1, Math.min(3, Number(headingMatch[1])));
      headingStack.splice(level - 1);
      headingStack[level - 1] = line;
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        headingPath: headingStack.filter(Boolean).join(' > '),
        lines: [line],
      };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  const units: ExtractedUnit[] = sections.map((sec, idx) => ({
    kind: 'section',
    number: idx + 1,
    label: sec.headingPath,
    headingPath: sec.headingPath,
    text: sec.lines.join('\n'),
  }));

  const totalChars = units.reduce((sum, u) => sum + u.text.length, 0);
  if (totalChars < 15 || units.length === 0) {
    throw new DocumentExtractionError(
      'EMPTY_DOCUMENT',
      'No readable text could be extracted from this DOCX document.',
    );
  }

  return { units, pageCount: units.length, totalChars, ocrUsed: false };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
      return na - nb;
    });

  const units: ExtractedUnit[] = [];
  let totalChars = 0;

  for (const slidePath of slideFiles) {
    const slideNum = Number(slidePath.match(/slide(\d+)\.xml/)?.[1] || units.length + 1);
    const xml = await zip.file(slidePath)!.async('string');
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((m) => decodeXmlEntities(m[1]).trim())
      .filter(Boolean);

    // Also include speaker notes if present
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesTexts: string[] = [];
    if (zip.file(notesPath)) {
      const notesXml = await zip.file(notesPath)!.async('string');
      notesTexts = Array.from(notesXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
        .map((m) => decodeXmlEntities(m[1]).trim())
        .filter((t) => t && !/^\d+$/.test(t));
    }

    const slideTitle = texts[0] ? `: ${texts[0].slice(0, 48)}` : '';
    const combined = [...texts, ...(notesTexts.length ? ['Notes: ' + notesTexts.join(' ')] : [])]
      .join('\n')
      .trim();

    if (combined) {
      totalChars += combined.length;
      units.push({
        kind: 'slide',
        number: slideNum,
        label: `Slide ${slideNum}${slideTitle}`,
        headingPath: `Slide ${slideNum}`,
        text: combined,
      });
    }
  }

  if (totalChars < 15 || units.length === 0) {
    throw new DocumentExtractionError(
      'EMPTY_DOCUMENT',
      'No readable text could be extracted from this PPTX presentation.',
    );
  }

  return { units, pageCount: slideFiles.length, totalChars, ocrUsed: false };
}

async function extractTxt(buffer: Buffer): Promise<ExtractionResult> {
  const raw = buffer.toString('utf-8').replace(/\r\n/g, '\n').trim();
  if (raw.length < 15) {
    throw new DocumentExtractionError(
      'EMPTY_DOCUMENT',
      'This text file does not contain enough readable content.',
    );
  }

  const lines = raw.split('\n');
  const sections: Array<{ label: string; lines: string[] }> = [];
  let current = { label: 'Section 1', lines: [] as string[] };

  for (const line of lines) {
    const trimmed = line.trim();
    const mdHeading = trimmed.match(/^#{1,3}\s+(.+)$/);
    const numberedHeading = trimmed.match(/^(\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z0-9\s\-:]{2,60})$/);
    if ((mdHeading || numberedHeading) && current.lines.length > 0) {
      sections.push(current);
      const title = (mdHeading?.[1] || numberedHeading?.[1] || '').trim();
      current = { label: title, lines: [title] };
    } else {
      if (mdHeading && current.lines.length === 0) {
        current.label = mdHeading[1].trim();
        current.lines.push(mdHeading[1].trim());
      } else {
        current.lines.push(line);
      }
    }
  }
  if (current.lines.length > 0) {
    sections.push(current);
  }

  // If single huge section, split cleanly into ~1500-char sections
  const finalUnits: ExtractedUnit[] = [];
  let secNo = 1;
  for (const sec of sections) {
    const text = sec.lines.join('\n').trim();
    if (!text) continue;
    if (text.length > 2200) {
      const paras = text.split(/\n{2,}/);
      let buf = '';
      for (const p of paras) {
        if (buf.length + p.length > 1600 && buf.trim()) {
          finalUnits.push({
            kind: 'section',
            number: secNo,
            label: `${sec.label} (Part ${secNo})`,
            headingPath: sec.label,
            text: buf.trim(),
          });
          secNo += 1;
          buf = p;
        } else {
          buf += (buf ? '\n\n' : '') + p;
        }
      }
      if (buf.trim()) {
        finalUnits.push({
          kind: 'section',
          number: secNo,
          label: secNo === 1 ? sec.label : `${sec.label}`,
          headingPath: sec.label,
          text: buf.trim(),
        });
        secNo += 1;
      }
    } else {
      finalUnits.push({
        kind: 'section',
        number: secNo,
        label: sec.label,
        headingPath: sec.label,
        text,
      });
      secNo += 1;
    }
  }

  return {
    units: finalUnits,
    pageCount: finalUnits.length,
    totalChars: raw.length,
    ocrUsed: false,
  };
}

export async function extractDocument(
  buffer: Buffer,
  ext: AllowedExt,
): Promise<ExtractionResult> {
  if (ext === 'pdf') return extractPdf(buffer);
  if (ext === 'docx') return extractDocx(buffer);
  if (ext === 'pptx') return extractPptx(buffer);
  return extractTxt(buffer);
}
