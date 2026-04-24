"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Folder,
  Mic2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video,
  Copy,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  EpisodeDto,
  ProjectDto,
  ReplacementDto,
  VoiceClipDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import {
  playVoicePreview,
  stopVoicePreview,
} from "@/lib/audio/voicePreviewPlayer";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

function formatUpdated(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 172_800_000) return "Yesterday";
    return `${Math.floor(diff / 86_400_000)} days ago`;
  } catch {
    return iso;
  }
}

type Props = {
  initialProject: ProjectDto;
  initialEpisodes: EpisodeDto[];
  initialCharacters: CharacterDto[];
};

export function ProjectDetailView({
  initialProject,
  initialEpisodes,
  initialCharacters,
}: Props) {
  const router = useRouter();
  const { refresh, setActiveProjectId, projects } = useProjects();
  const toast = useToast();
  const [project, setProject] = useState(initialProject);
  const episodes = initialEpisodes;
  const characters = initialCharacters;
  const [replacements, setReplacements] = useState<ReplacementDto[]>([]);
  const [voiceClips, setVoiceClips] = useState<VoiceClipDto[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRemoveEp, setConfirmRemoveEp] = useState<EpisodeDto | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);

  useEffect(() => {
    return () => stopVoicePreview();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.listProjectReplacements(project.id).then((rows) => {
      if (!cancelled) setReplacements(rows);
    }).catch(() => { if (!cancelled) setReplacements([]); });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    void api.listProjectClips(project.id).then((rows) => {
      if (!cancelled) setVoiceClips(rows);
    }).catch(() => { if (!cancelled) setVoiceClips([]); });
    return () => { cancelled = true; };
  }, [project.id]);

  const charCount = characters.length;
  const voiced = characters.filter((c) => c.default_voice_id).length;
  const importedEpisodes = episodes.filter((e) => e.segment_count > 0).length;
  const replacementCount = replacements.length;
  const linesWithAudio = replacements.filter((r) => r.generated_audio_path).length;
  const transcriptLineTotal = episodes.reduce((acc, e) => acc + (e.segment_count ?? 0), 0);
  const clipCount = voiceClips.length;
  const videoEpisodes = episodes.filter((e) => (e.media_type ?? "video") === "video").length;
  const audioEpisodes = episodes.filter((e) => e.media_type === "audio").length;

  const sortedEpisodes = useMemo(
    () => [...episodes].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [episodes],
  );
  const recentReplacements = useMemo(
    () => [...replacements].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5),
    [replacements],
  );
  const mostRecentEpisode = sortedEpisodes[0];

  const blockedLines = characters.filter((c) => !c.default_voice_id).reduce((acc, c) => {
    const ep = episodes.find((e) => e.segment_count > 0);
    return acc + (ep ? Math.max(0, Math.floor(ep.segment_count / charCount)) : 0);
  }, 0);
  const needsVoiceChar = characters.find((c) => !c.default_voice_id);

  async function saveProject() {
    setSaving(true); setErr(null);
    try {
      const p = await api.patchProject(project.id, { name: editName.trim(), description: editDesc.trim() });
      setProject(p); setEditOpen(false); await refresh(); toast("Project saved");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function executeRemoveEpisodeImport() {
    const ep = confirmRemoveEp; if (!ep) return; setConfirmRemoveEp(null); setErr(null);
    try { await api.deleteEpisode(ep.id); toast("Import removed"); router.refresh(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Could not remove"); }
  }

  async function executeRemoveProject() {
    setConfirmDeleteProject(false); setDeleting(true); setErr(null);
    try { await api.deleteProject(project.id); await refresh(); router.push("/projects"); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Could not delete"); }
    finally { setDeleting(false); }
  }

  const charColors = ["bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700"];

  return (
    <>
      {/* Page header */}
      <header className="h-16 shrink-0 bg-surface border-b border-border flex items-center px-10 gap-6">
        <nav className="flex items-center gap-2.5 text-sm">
          <Link href="/projects" className="text-foreground-muted font-medium hover:text-foreground transition-colors">Projects</Link>
          <span className="text-border">/</span>
          <span className="px-2.5 py-1 rounded-md bg-canvas border border-border text-foreground font-semibold text-[13px]">
            {project.name}
          </span>
        </nav>
        <div className="flex-1" />
        <div className="relative">
          <Search className="size-3.5 text-foreground-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input placeholder="Search this project" className="h-9 pl-8 pr-3 w-72 text-[13px] bg-canvas border border-border rounded-md focus:outline-none focus:border-border-strong" />
        </div>
        <Link href="/upload-match" className="h-9 px-4 rounded-md text-sm font-semibold bg-foreground text-surface hover:bg-foreground/90 transition-colors flex items-center gap-2 shadow-sm">
          <Plus className="size-4" /> New import
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-10 py-10 max-w-[1640px] mx-auto">
          {/* Hero */}
          <div className="flex items-end justify-between gap-8 mb-10 pb-8 border-b border-border">
            <div className="min-w-0">
              <div className="label-section mb-3">Project</div>
              {editOpen ? (
                <div className="space-y-3 max-w-lg">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-12 w-full px-4 text-[24px] font-bold bg-canvas border border-border rounded-lg focus:outline-none focus:border-border-strong" />
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} className="w-full px-4 py-2 text-[14px] bg-canvas border border-border rounded-lg focus:outline-none focus:border-border-strong resize-none" />
                  <div className="flex gap-2">
                    <button onClick={saveProject} disabled={saving} className="h-9 px-4 rounded-md text-[13px] font-bold bg-foreground text-surface hover:bg-foreground/90 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
                    <button onClick={() => { setEditOpen(false); setEditName(project.name); setEditDesc(project.description ?? ""); }} className="h-9 px-4 rounded-md text-[13px] font-semibold text-foreground-muted hover:text-foreground">Cancel</button>
                  </div>
                  {err && <p className="text-[12px] text-danger">{err}</p>}
                </div>
              ) : (
                <>
                  <h1 className="text-[44px] font-bold tracking-tight leading-[1.05]">{project.name}</h1>
                  <p className="text-[15px] text-foreground-muted mt-3 max-w-2xl leading-relaxed">
                    {project.description || `${episodes.length} episode${episodes.length !== 1 ? "s" : ""}. ${charCount} character${charCount !== 1 ? "s" : ""} cast, ${voiced} voice${voiced !== 1 ? "s" : ""} attached. Last activity ${formatUpdated(project.updated_at)}.`}
                  </p>
                  <div className="flex items-center gap-6 mt-5 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-success" />
                      <span className="text-foreground-muted">Generated</span>
                      <span className="font-bold num">{linesWithAudio}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-accent" />
                      <span className="text-foreground-muted">Ready</span>
                      <span className="font-bold num">{transcriptLineTotal - linesWithAudio - blockedLines}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-warning" />
                      <span className="text-foreground-muted">Blocked</span>
                      <span className="font-bold num">{blockedLines}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            {!editOpen && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditOpen(true)} className="h-10 px-3.5 rounded-md text-[13px] font-semibold text-foreground-muted hover:text-foreground bg-surface border border-border hover:border-border-strong transition-colors flex items-center gap-2">
                  <Folder className="size-4" /> Project settings
                </button>
                {mostRecentEpisode && (
                  <Link href={`/upload-match?episode=${encodeURIComponent(mostRecentEpisode.id)}`} className="h-10 px-4 rounded-md text-[13px] font-bold bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-2 shadow-sm">
                    Resume {mostRecentEpisode.title?.slice(0, 20) || "editing"} <ArrowRight className="size-4" />
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-4 gap-4 mb-12">
            {[
              { k: "Episodes", v: String(episodes.length), sub: `${videoEpisodes} video${audioEpisodes > 0 ? ` \u00B7 ${audioEpisodes} audio` : ""}` },
              { k: "Characters", v: String(charCount), sub: `${voiced} with voice attached` },
              { k: "Lines", v: String(transcriptLineTotal), sub: `${linesWithAudio} generated` },
              { k: "Saved clips", v: String(clipCount), sub: `${replacementCount} line take${replacementCount !== 1 ? "s" : ""}` },
            ].map((s) => (
              <div key={s.k} className="bg-surface border border-border rounded-xl p-5 hover:border-border-strong transition-colors">
                <div className="label-section">{s.k}</div>
                <div className="text-[36px] font-bold tracking-tight num mt-2 leading-none">{s.v}</div>
                <div className="text-[12px] text-foreground-subtle num mt-2.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Two-column grid */}
          <div className="grid grid-cols-[1fr_360px] gap-8">
            {/* Episodes */}
            <section>
              <div className="flex items-end justify-between mb-5">
                <div>
                  <h2 className="text-[20px] font-bold tracking-tight">Imported episodes</h2>
                  <p className="text-[13px] text-foreground-muted mt-0.5">Continue where you left off, or start a new import.</p>
                </div>
                {episodes.length > 4 && (
                  <Link href="/upload-match" className="text-[12.5px] font-semibold text-foreground-muted hover:text-foreground flex items-center gap-1.5">
                    View all <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {sortedEpisodes.slice(0, 4).map((ep) => {
                  const isAudio = ep.media_type === "audio";
                  const genLines = replacements.filter((r) => r.episode_id === ep.id && r.generated_audio_path).length;
                  const totalLines = ep.segment_count ?? 0;
                  const pct = totalLines > 0 ? (genLines / totalLines) * 100 : 0;
                  const isComplete = totalLines > 0 && genLines >= totalLines;
                  const thumbUrl = !isAudio && ep.thumbnail_paths?.length ? mediaUrl(ep.thumbnail_paths[0]!) : null;

                  return (
                    <Link
                      key={ep.id}
                      href={`/upload-match?episode=${encodeURIComponent(ep.id)}`}
                      className="group bg-surface border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-sm transition-all"
                    >
                      <div className={`relative aspect-[16/8] overflow-hidden ${isAudio ? "bg-gradient-to-br from-canvas via-surface-sunken to-canvas" : "bg-canvas"}`}>
                        {thumbUrl ? (
                          <img src={thumbUrl} alt={ep.title || ""} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="flex items-end gap-[3px] h-12">
                              {[14,22,9,28,18,32,12,26,8,20,30,16,24,10,22].map((h, i) => (
                                <span key={i} className="w-[3px] rounded-full bg-foreground-muted/40" style={{ height: `${h}px` }} />
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-foreground/85 text-surface text-[10.5px] font-bold backdrop-blur-sm">
                          {isAudio ? <Mic2 className="size-3" /> : <Video className="size-3" />}
                          {isAudio ? "AUDIO" : "VIDEO"}
                        </div>
                        {totalLines > 0 && (
                          <div className="absolute top-3 right-3">
                            <span className={`text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${isComplete ? "bg-success-soft text-success" : "bg-accent-soft text-accent"}`}>
                              {isComplete ? "Complete" : "In progress"}
                            </span>
                          </div>
                        )}
                        {ep.duration_sec != null && ep.duration_sec > 0 && (
                          <div className="absolute bottom-3 right-3 num text-[11px] font-bold text-surface bg-foreground/80 px-1.5 py-0.5 rounded">
                            {`${Math.floor(ep.duration_sec / 60)}:${String(Math.floor(ep.duration_sec % 60)).padStart(2, "0")}`}
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-bold text-[15px] tracking-tight truncate">{ep.title || "Untitled"}</h3>
                          <span role="button" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmRemoveEp(ep); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setConfirmRemoveEp(ep); } }} className="text-foreground-subtle hover:text-foreground -mr-1 -mt-1 p-1 cursor-pointer">
                            <MoreHorizontal className="size-4" />
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-[11.5px] text-foreground-subtle num">
                          <span>{genLines}/{totalLines} lines</span>
                          <span>&middot;</span>
                          <span className="flex items-center gap-1"><Clock className="size-3" /> {formatUpdated(ep.updated_at)}</span>
                        </div>
                        {totalLines > 0 && (
                          <div className="mt-2.5 h-1 rounded-full bg-canvas overflow-hidden">
                            <div className={`h-full ${isComplete ? "bg-success" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}

                {/* New import card */}
                <Link href="/upload-match" className="group bg-canvas border-2 border-dashed border-border-strong rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-foreground-muted hover:border-accent hover:text-accent hover:bg-accent-soft/30 transition-all min-h-[220px]">
                  <div className="size-12 rounded-full bg-surface border border-border flex items-center justify-center group-hover:border-accent">
                    <Plus className="size-5" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-[14px]">Import video or audio</div>
                    <div className="text-[12px] mt-1 text-foreground-subtle">Drop a file to start a new episode</div>
                  </div>
                </Link>
              </div>
            </section>

            {/* Right rail */}
            <aside className="flex flex-col gap-8">
              {/* Characters & voices */}
              <section>
                <div className="flex items-end justify-between mb-4">
                  <h2 className="text-[16px] font-bold tracking-tight">Characters & voices</h2>
                  <Link href="/voice-studio" className="text-[12px] font-semibold text-accent hover:text-accent-hover">Open voice library</Link>
                </div>
                <div className="bg-surface border border-border rounded-xl divide-y divide-border-subtle">
                  {characters.length === 0 ? (
                    <div className="p-4 text-[13px] text-foreground-muted">No characters yet. Import media or add one manually.</div>
                  ) : characters.map((c, i) => {
                    const color = charColors[i % charColors.length];
                    const initials = c.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <div key={c.id} className="p-3.5 flex items-center gap-3">
                        <div className={`size-9 rounded-full flex items-center justify-center text-[12px] font-bold ${color}`}>{initials}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold truncate">{c.name}</div>
                          <div className="text-[11px] text-foreground-subtle num">{replacements.filter(r => r.character_id === c.id).length} lines</div>
                        </div>
                        {c.default_voice_id ? (
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-success">
                            <CheckCircle2 className="size-3.5" /> {c.voice_display_name || "Voice"}
                          </div>
                        ) : (
                          <Link href="/voice-studio" className="text-[11px] font-semibold text-warning-foreground bg-warning-soft border border-warning-border px-2 py-1 rounded-md hover:bg-warning-soft/70 flex items-center gap-1">
                            <AlertCircle className="size-3" /> Attach
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Recent clips */}
              {recentReplacements.length > 0 && (
                <section>
                  <div className="flex items-end justify-between mb-4">
                    <h2 className="text-[16px] font-bold tracking-tight">Recent clips</h2>
                    <a href={api.projectClipsZipUrl(project.id)} download className="text-[12px] font-semibold text-foreground-muted hover:text-foreground flex items-center gap-1">
                      <Download className="size-3.5" /> Export all
                    </a>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {recentReplacements.map((r) => (
                      <div key={r.replacement_id} className="h-12 px-2.5 rounded-lg border border-border bg-surface hover:border-border-strong transition-colors flex items-center gap-3">
                        {r.audio_url ? (
                          <button onClick={() => { const url = mediaUrl(r.audio_url!.replace(/^\/media\//, "")); playVoicePreview(url); }} className="size-7 rounded-full bg-canvas border border-border flex items-center justify-center hover:border-foreground-muted">
                            <Play className="size-3 fill-foreground text-foreground ml-0.5" />
                          </button>
                        ) : (
                          <div className="size-7 rounded-full bg-canvas border border-border flex items-center justify-center">
                            <Clock className="size-3 text-foreground-subtle" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold truncate">{r.replacement_text?.slice(0, 40) || "Line"}{r.replacement_text && r.replacement_text.length > 40 ? "..." : ""}</div>
                          <div className="text-[10.5px] text-foreground-subtle num">{r.character_id?.slice(0, 8)} &middot; {formatUpdated(r.updated_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Next step callout */}
              {needsVoiceChar && (
                <section className="rounded-xl border border-accent/20 bg-accent-soft/40 p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="size-4 text-accent" />
                    <span className="text-[12px] font-bold text-accent uppercase tracking-wider">Next step</span>
                  </div>
                  <div className="text-[13.5px] font-semibold text-foreground leading-snug">
                    {needsVoiceChar.name} still needs a voice.
                  </div>
                  <p className="text-[12px] text-foreground-muted mt-1.5 leading-relaxed">
                    Once attached, pending lines can be generated in a single batch.
                  </p>
                  <Link href="/voice-studio" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:text-accent-hover">
                    Open voice library <ArrowRight className="size-3.5" />
                  </Link>
                </section>
              )}
            </aside>
          </div>
        </div>
      </main>

      {/* Modals */}
      <ConfirmModal
        open={!!confirmRemoveEp}
        title="Remove episode?"
        confirmLabel="Remove"
        danger
        onConfirm={executeRemoveEpisodeImport}
        onCancel={() => setConfirmRemoveEp(null)}
      >
        This will remove &ldquo;{confirmRemoveEp?.title || "this episode"}&rdquo; and all its data from this project.
      </ConfirmModal>
      <ConfirmModal
        open={confirmDeleteProject}
        title="Delete project?"
        confirmLabel="Delete project"
        danger
        onConfirm={executeRemoveProject}
        onCancel={() => setConfirmDeleteProject(false)}
      >
        This cannot be undone. All episodes, characters, and clips will be permanently deleted.
      </ConfirmModal>
    </>
  );
}
