import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { RELEASES, SOURCE_URL } from "@/lib/changelog";
import { Brand } from "../ui/Brand";

export default function ChangelogPage() {
  return (
    <main className="changelog-shell">
      <header className="topbar">
        <Brand />
        <Link className="home-link" href="/">PLAY</Link>
      </header>
      <section className="changelog-page">
        <div className="changelog-heading">
          <p className="eyebrow"><span /> VERSION HISTORY</p>
          <h1>WHAT&apos;S NEW</h1>
          <p>Latest first. Production, Staging, and Development use the same release notes.</p>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">VIEW ALL SOURCE ON GITHUB ↗</a>
        </div>
        <ol className="release-list">
          {RELEASES.map((release, index) => (
            <li className={index === 0 ? "release-card latest" : "release-card"} key={release.version}>
              <div className="release-meta">
                <span>v{release.version}</span>
                {release.version === APP_VERSION ? <b>CURRENT HERE</b> : null}
                <time dateTime={release.date}>{release.date}</time>
              </div>
              <div>
                <h2>{release.title}</h2>
                <p>{release.summary}</p>
                <ul>
                  {release.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
                <a href={release.githubUrl} target="_blank" rel="noopener noreferrer">
                  VIEW v{release.version} ON GITHUB ↗
                </a>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
