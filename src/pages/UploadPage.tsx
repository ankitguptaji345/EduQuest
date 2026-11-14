import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Loader2,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError, uploadDocumentWithProgress } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { DocumentJob, StudyDocument, Subject } from '../types/api';

const MAX_MB = 20;
const ALLOWED_EXTS = ['pdf', 'docx', 'pptx', 'txt'];
const PIPELINE_STAGES = ['queued', 'extracting', 'chunking', 'embedding', 'analyzing', 'ready'] as const;

export function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    existing_document_id: string;
    existing_title: string;
    message: string;
  } | null>(null);

  const [createdDoc, setCreatedDoc] = useState<StudyDocument | null>(null);
  const [jobState, setJobState] = useState<DocumentJob | null>(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);

  const { data: subjectsData, refetch: refetchSubjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => apiFetch<{ items: Subject[] }>('/api/subjects'),
  });

  const handleSelectFile = (f: File | undefined) => {
    setErrorMsg(null);
    setDuplicateWarning(null);
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTS.includes(ext)) {
      setErrorMsg('Unsupported file type. Please upload PDF, DOCX, PPTX, or TXT.');
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setErrorMsg(`File exceeds the ${MAX_MB} MB upload limit.`);
      return;
    }
    setFile(f);
    if (!title) {
      setTitle(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) return;
    try {
      const res = await apiFetch<{ subject: Subject }>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name: newSubjectName.trim() }),
      });
      setNewSubjectName('');
      await refetchSubjects();
      setSubjectId(res.subject.id);
      addToast('success', `Subject "${res.subject.name}" added.`);
    } catch (err) {
      addToast('error', err instanceof ApiError ? err.message : 'Could not create subject.');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMsg('Please select a study file first.');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    setErrorMsg(null);
    setDuplicateWarning(null);

    try {
      const res = await uploadDocumentWithProgress(
        { file, title: title.trim() || undefined, subjectId: subjectId || undefined },
        (pct) => setUploadPct(pct),
      );
      const doc = res.document as unknown as StudyDocument;
      const job = res.job as unknown as DocumentJob;
      setCreatedDoc(doc);
      setJobState(job);
      setDocStatus(doc.status);
      if (res.duplicate_warning) {
        setDuplicateWarning(res.duplicate_warning);
      }
      addToast('info', 'File uploaded! Processing study material in background.');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  // Poll job stage until ready or failed
  useEffect(() => {
    if (!createdDoc) return;
    if (docStatus === 'ready' || docStatus === 'failed') return;

    const timer = setInterval(async () => {
      try {
        const res = await apiFetch<{ document_status: string; job: DocumentJob }>(
          `/api/documents/${createdDoc.id}/job`,
        );
        setDocStatus(res.document_status);
        setJobState(res.job);
        if (res.document_status === 'ready') {
          void queryClient.invalidateQueries({ queryKey: ['documents'] });
          void queryClient.invalidateQueries({ queryKey: ['worlds'] });
          void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
          addToast('success', 'Document processed and topics extracted!');
        } else if (res.document_status === 'failed') {
          void queryClient.invalidateQueries({ queryKey: ['documents'] });
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [createdDoc, docStatus, queryClient, addToast]);

  const currentStage = docStatus === 'ready' ? 'ready' : jobState?.stage || 'queued';
  const stageIdx = PIPELINE_STAGES.indexOf(currentStage as (typeof PIPELINE_STAGES)[number]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="eq-hero-surface rounded-2xl p-6 space-y-1.5">
        <p className="text-xs font-medium text-[#22D3EE]">Ingestion & Topic Extraction</p>
        <h1 className="font-display text-2xl font-bold text-[#F8FAFC]">Upload Study Material</h1>
        <p className="text-sm text-[#94A3B8] leading-relaxed">
          Upload PDF, DOCX, PPTX, or TXT notes (up to {MAX_MB} MB). The Rule-Based Engine extracts
          sections, builds grounded topics, and prepares quizzes and worlds.
        </p>
      </div>

      {!createdDoc ? (
        <form onSubmit={handleUpload} className="eq-card rounded-2xl p-6 space-y-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              handleSelectFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
              dragActive
                ? 'border-[#22D3EE] bg-[#22D3EE]/10'
                : file
                  ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/5'
                  : 'border-slate-400/25 hover:border-[#8B5CF6]/60 bg-[#11182B]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.txt"
              className="hidden"
              onChange={(e) => handleSelectFile(e.target.files?.[0])}
            />
            <div className="w-12 h-12 rounded-2xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center mx-auto mb-3.5">
              <FileUp className="w-6 h-6 text-[#22D3EE]" />
            </div>
            {file ? (
              <div className="space-y-1">
                <p className="font-display font-semibold text-[#F8FAFC]">{file.name}</p>
                <p className="text-xs text-[#94A3B8] tabular-nums">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB · Click to change file
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-[#F8FAFC]">
                  Drag and drop your study material here, or click to browse
                </p>
                <p className="text-xs text-[#94A3B8]">
                  Supports PDF (text-based), DOCX, PPTX, and TXT · Max {MAX_MB} MB
                </p>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="doc-title" className="text-xs font-medium text-[#94A3B8]">
                Document Title
              </label>
              <input
                id="doc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Data Structures Lecture 3"
                className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="doc-subject" className="text-xs font-medium text-[#94A3B8]">
                Subject (Optional)
              </label>
              <select
                id="doc-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
              >
                <option value="">Uncategorized</option>
                {(subjectsData?.items || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Inline Subject Creation */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="Or add a new subject..."
              className="flex-1 bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
            <button
              type="button"
              onClick={handleCreateSubject}
              className="px-4 py-2 rounded-xl bg-[#1B2740] border border-slate-400/20 text-xs font-semibold text-[#F8FAFC] hover:border-[#22D3EE]/50 transition-colors whitespace-nowrap shrink-0"
            >
              Add Subject
            </button>
          </div>

          {uploading && (
            <div className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-2">
              <div className="flex justify-between text-xs text-[#94A3B8] tabular-nums">
                <span className="font-medium text-[#F8FAFC]">Uploading file...</span>
                <span className="font-mono text-[#22D3EE]">{uploadPct}%</span>
              </div>
              <div className="h-2 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
                <div
                  className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444] flex items-start gap-2.5">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading || !file}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
              {uploading ? 'Uploading...' : 'Upload & Process'}
            </button>
          </div>
        </form>
      ) : (
        <div className="eq-card rounded-2xl p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-[#22D3EE] font-medium">Processing Pipeline · Rule-Based Engine</p>
              <h2 className="font-display text-xl font-bold text-[#F8FAFC] mt-0.5 truncate">
                {createdDoc.title}
              </h2>
            </div>
            <span
              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold uppercase tracking-wide ${
                docStatus === 'ready'
                  ? 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]'
                  : docStatus === 'failed'
                    ? 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]'
                    : 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]'
              }`}
            >
              {docStatus || 'processing'}
            </span>
          </div>

          {duplicateWarning && (
            <div className="p-3.5 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B] flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {duplicateWarning.message}{' '}
                <Link to={`/documents/${duplicateWarning.existing_document_id}`} className="underline font-semibold">
                  View existing file
                </Link>
              </span>
            </div>
          )}

          {/* Stage Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
            {PIPELINE_STAGES.map((stage, idx) => {
              const isDone = docStatus === 'ready' || (stageIdx > idx && docStatus !== 'failed');
              const isActive = currentStage === stage && docStatus !== 'ready' && docStatus !== 'failed';
              return (
                <div
                  key={stage}
                  className={`p-3.5 rounded-xl border text-center space-y-1.5 transition-all ${
                    isDone
                      ? 'bg-[#22C55E]/10 border-[#22C55E]/35 text-[#22C55E]'
                      : isActive
                        ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/45 text-[#F8FAFC]'
                        : 'bg-[#11182B] border-slate-400/15 text-[#94A3B8]'
                  }`}
                >
                  <div className="flex justify-center">
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#22D3EE]" />
                    ) : (
                      <span className="text-xs font-mono tabular-nums">{idx + 1}</span>
                    )}
                  </div>
                  <p className="text-xs capitalize font-semibold">{stage}</p>
                </div>
              );
            })}
          </div>

          {docStatus === 'failed' && jobState?.last_error_safe && (
            <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444] space-y-2">
              <div className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Processing stopped ({jobState.last_error_code || 'EXTRACTION_ERROR'})
                  </p>
                  <p className="text-xs mt-1 text-[#F8FAFC]/90">{jobState.last_error_safe}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3 pt-3 border-t border-slate-400/15">
            <button
              type="button"
              onClick={() => {
                setCreatedDoc(null);
                setJobState(null);
                setDocStatus(null);
                setFile(null);
                setTitle('');
              }}
              className="px-4 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
            >
              Upload Another File
            </button>

            {docStatus === 'ready' && (
              <button
                type="button"
                onClick={() => navigate(`/documents/${createdDoc.id}`)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Open Document & Topics
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
