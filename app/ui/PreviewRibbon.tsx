import Link from "next/link";
import { previewBranch, previewCommit } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

const FALLBACK_BRANCH = "feature/capture-combat-animations";

export function PreviewRibbon() {
  const branch = previewBranch() ?? FALLBACK_BRANCH;
  const commit = previewCommit();
  const sourceUrl = `https://github.com/ripper234/ChessRiot/tree/${branch}`;

  return (
    <aside className="feature-preview-ribbon" aria-label="Feature preview build">
      <Link href="/capture-lab">
        <strong>PREVIEW</strong>
        <span>{branch}</span>
        <b>v{APP_VERSION}</b>
        <code>{commit ? commit.slice(0, 8) : "LOCAL"}</code>
      </Link>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">SOURCE ↗</a>
    </aside>
  );
}
