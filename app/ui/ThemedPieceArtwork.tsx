import type { PieceSymbol } from "chess.js";
import type { ThemeId } from "@/lib/themes";

function ClassicPiece({ type }: { type: PieceSymbol }) {
  switch (type) {
    case "p": return <><circle className="piece-silhouette" cx="50" cy="27" r="12" /><path className="piece-silhouette" d="M38 45c0-5 5-9 12-9s12 4 12 9c0 8-4 15-8 21H38c-4-6-8-13-8-21Z" /><path className="piece-silhouette" d="M31 63h38l6 14H25Z" /><path className="piece-silhouette" d="M21 77h58v11H21Z" /></>;
    case "r": return <><path className="piece-silhouette" d="M23 18h13v10h9V18h10v10h9V18h13v25H23Z" /><path className="piece-silhouette" d="M31 42h38l-4 31H35Z" /><path className="piece-silhouette" d="M27 69h46l5 10H22Z" /><path className="piece-silhouette" d="M19 79h62v10H19Z" /><path className="piece-detail" d="M31 43h38M35 69h30" /></>;
    case "n": return <><path className="piece-silhouette" d="M29 70c2-13 7-24 17-34l-4-13 15 6 12-10 9 19-3 20-18 13H43Z" /><path className="piece-silhouette" d="M29 68h41l7 12H22Z" /><path className="piece-silhouette" d="M19 79h62v10H19Z" /><circle className="piece-detail-fill" cx="62" cy="37" r="2.8" /><path className="piece-detail" d="M48 36c7 3 12 7 15 13" /></>;
    case "b": return <><path className="piece-silhouette" d="M50 16c10 10 16 19 16 28 0 8-6 15-16 21-10-6-16-13-16-21 0-9 6-18 16-28Z" /><path className="piece-detail" d="M58 27 43 49" /><path className="piece-silhouette" d="M34 61h32l8 17H26Z" /><path className="piece-silhouette" d="M21 78h58v11H21Z" /></>;
    case "q": return <><circle className="piece-silhouette" cx="20" cy="24" r="4" /><circle className="piece-silhouette" cx="35" cy="18" r="4" /><circle className="piece-silhouette" cx="50" cy="15" r="4" /><circle className="piece-silhouette" cx="65" cy="18" r="4" /><circle className="piece-silhouette" cx="80" cy="24" r="4" /><path className="piece-silhouette" d="m20 27 13 25 2-31 15 29 15-29 2 31 13-25-8 39H28Z" /><path className="piece-silhouette" d="M29 64h42l6 15H23Z" /><path className="piece-silhouette" d="M19 79h62v10H19Z" /></>;
    case "k": return <><path className="piece-silhouette" d="M46 10h8v12h11v8H54v12h-8V30H35v-8h11Z" /><path className="piece-silhouette" d="M31 39c5-6 11-9 19-9s14 3 19 9l-7 19H38Z" /><path className="piece-silhouette" d="M37 55h26l9 22H28Z" /><path className="piece-silhouette" d="M21 77h58v12H21Z" /></>;
  }
}

function OceanPiece({ type }: { type: PieceSymbol }) {
  const base = <><path className="piece-silhouette" d="M18 82c10-7 18 7 28 0s18 7 36 0v9H18Z" /><path className="piece-detail" d="M23 76c9-7 16 7 25 0s16 7 29 0" /></>;
  let body;
  switch (type) {
    case "p": body = <><circle className="piece-silhouette" cx="50" cy="31" r="14" /><path className="piece-silhouette" d="M34 67c5-18 11-26 16-26s11 8 16 26Z" /><path className="piece-detail" d="M39 30c5-5 14-7 21-2" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="M35 69c-2-18 4-31 17-39l-8-10c21 0 34 11 34 28-8-7-14-8-20-3 8 4 10 12 4 24Z" /><circle className="piece-detail-fill" cx="64" cy="34" r="3" /><path className="piece-detail" d="M43 48c8 2 13 8 13 18" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="M28 65 50 16l22 49Z" /><path className="piece-detail" d="M50 18v48M50 27l16 27H50" /><circle className="piece-silhouette" cx="50" cy="16" r="5" /></>; break;
    case "r": body = <><path className="piece-silhouette" d="M37 22h26l6 47H31Z" /><path className="piece-silhouette" d="M31 20h38v12H31Z" /><path className="piece-detail" d="M43 35h14M41 49h18M39 62h22" /><path className="piece-silhouette" d="M44 10h12v10H44Z" /></>; break;
    case "q": body = <><path className="piece-silhouette" d="M27 66c-3-21 8-39 23-53 15 14 26 32 23 53Z" /><path className="piece-detail" d="M50 18c-7 12-7 25 0 39 7-14 7-27 0-39ZM34 29c13 8 19 20 18 35M66 29C53 37 47 49 48 64" /><circle className="piece-silhouette" cx="50" cy="12" r="6" /></>; break;
    case "k": body = <><path className="piece-silhouette" d="M46 12h8v20l11-12 5 5-16 20v24h-8V45L30 25l5-5 11 12Z" /><path className="piece-silhouette" d="M31 66h38l6 12H25Z" /><path className="piece-detail" d="M35 50h30" /></>; break;
  }
  return <>{body}{base}</>;
}

function RiotPiece({ type }: { type: PieceSymbol }) {
  const base = <><path className="piece-silhouette" d="m19 86 9-18h44l9 18Z" /><path className="piece-detail" d="M28 77h44" /></>;
  let body;
  switch (type) {
    case "p": body = <><path className="piece-silhouette" d="m50 14 15 10-5 19 9 24H31l9-24-5-19Z" /><path className="piece-detail" d="m39 30 11 7 11-7M42 51h16" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="m60 12-28 34h17L36 69l34-39H54Z" /><path className="piece-detail" d="m43 45 14-5" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="m50 12 23 25-23 32-23-32Z" /><path className="piece-detail" d="M61 25 39 55M35 37h30" /></>; break;
    case "r": body = <><path className="piece-silhouette" d="M28 20h44v49H28Z" /><path className="piece-detail" d="M36 29h28v13H36ZM36 51h28M41 58v11M59 58v11" /><path className="piece-silhouette" d="M23 14h18v13H23Zm36 0h18v13H59Z" /></>; break;
    case "q": body = <><path className="piece-silhouette" d="m50 10 9 18 20 3-15 14 4 21-18-10-18 10 4-21-15-14 20-3Z" /><circle className="piece-detail-fill" cx="50" cy="39" r="6" /></>; break;
    case "k": body = <><path className="piece-silhouette" d="M25 25 39 37l11-24 11 24 14-12-7 42H32Z" /><path className="piece-detail" d="M35 48h30M46 34h8" /></>; break;
  }
  return <>{body}{base}</>;
}

function ToyboxPiece({ type }: { type: PieceSymbol }) {
  const base = <><rect className="piece-silhouette" x="18" y="76" width="64" height="14" rx="3" /><circle className="piece-detail-fill" cx="29" cy="83" r="2" /><circle className="piece-detail-fill" cx="71" cy="83" r="2" /></>;
  let body;
  switch (type) {
    case "p": body = <><circle className="piece-silhouette" cx="50" cy="27" r="13" /><rect className="piece-silhouette" x="35" y="40" width="30" height="34" rx="8" /><circle className="piece-detail-fill" cx="45" cy="25" r="2" /><circle className="piece-detail-fill" cx="55" cy="25" r="2" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="M26 66c7-24 19-39 38-46l12 15-15 9 8 25H39Z" /><path className="piece-detail" d="M25 69c15 8 35 8 50 0M54 31l10 5" /><circle className="piece-detail-fill" cx="63" cy="31" r="2" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="m50 12 17 19-7 35H40l-7-35Z" /><path className="piece-silhouette" d="M40 66h20l7 10H33Z" /><path className="piece-detail" d="M50 24v33M41 36h18" /></>; break;
    case "r": body = <><rect className="piece-silhouette" x="27" y="30" width="46" height="46" rx="3" /><path className="piece-silhouette" d="M23 16h15v15H23Zm20 0h14v15H43Zm19 0h15v15H62Z" /><path className="piece-detail" d="M38 45h24v31H38Z" /></>; break;
    case "q": body = <><circle className="piece-silhouette" cx="50" cy="40" r="24" /><path className="piece-detail" d="m50 20 6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2Z" /><rect className="piece-silhouette" x="35" y="63" width="30" height="13" rx="4" /></>; break;
    case "k": body = <><rect className="piece-silhouette" x="30" y="35" width="40" height="41" rx="6" /><path className="piece-silhouette" d="M39 16h22v19H39Z" /><path className="piece-detail" d="M50 12v27M43 23h14M39 50h22" /></>; break;
  }
  return <>{body}{base}</>;
}

function ArenaPiece({ type }: { type: PieceSymbol }) {
  const base = <path className="piece-silhouette" d="M17 85 27 69h46l10 16-8 7H25Z" />;
  let mark;
  switch (type) {
    case "p": mark = <><path className="piece-silhouette" d="M35 62c-5-12 0-25 12-29l-3-14 13 8 11-5 4 15-10 6-2 25H40Z" /><path className="piece-detail" d="M44 48h17" /></>; break;
    case "n": mark = <><path className="piece-silhouette" d="M28 66c8-7 15-18 19-33l-6-15 19 8 12-7 7 18-15 9 5 22Z" /><path className="piece-detail" d="m51 35 14 4" /><circle className="piece-detail-fill" cx="65" cy="34" r="3" /></>; break;
    case "b": mark = <><path className="piece-silhouette" d="m50 13 27 20-10 35H33L23 33Z" /><path className="piece-detail" d="m34 50 32-17M40 28l20 27" /></>; break;
    case "r": mark = <><path className="piece-silhouette" d="M50 15 78 29l-6 28c-3 10-11 16-22 20-11-4-19-10-22-20l-6-28Z" /><path className="piece-detail" d="M35 32h30v27H35ZM35 46h30" /></>; break;
    case "q": mark = <><path className="piece-silhouette" d="m50 10 9 18 20 3-15 14 4 20-18-9-18 9 4-20-15-14 20-3Z" /><path className="piece-detail" d="M35 43h30" /></>; break;
    case "k": mark = <><path className="piece-silhouette" d="M26 31 40 40l10-28 10 28 14-9-5 37H31Z" /><path className="piece-detail" d="M34 52h32M44 30h12" /></>; break;
  }
  return <>{mark}{base}</>;
}

function FantasyPiece({ type }: { type: PieceSymbol }) {
  const base = <><path className="piece-silhouette" d="M20 87 31 68h38l11 19Z" /><path className="piece-detail" d="M28 78h44" /></>;
  let body;
  switch (type) {
    case "p": body = <><path className="piece-silhouette" d="M33 68c1-23 4-40 17-51 13 11 16 28 17 51Z" /><path className="piece-detail" d="M37 37h26M43 26v25M57 26v25" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="M26 69c11-16 16-28 17-40l-8-10 18 3 11-11 2 17 13 10-16 7 7 24Z" /><path className="piece-detail" d="M48 34c9 0 15 4 19 11" /><circle className="piece-detail-fill" cx="61" cy="29" r="3" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="M50 11c14 15 21 26 21 35 0 11-8 18-21 23-13-5-21-12-21-23 0-9 7-20 21-35Z" /><path className="piece-detail" d="M59 24 40 54M33 43h34" /></>; break;
    case "r": body = <><path className="piece-silhouette" d="M29 29h42l-5 40H34Z" /><path className="piece-silhouette" d="M24 14h15v16H24Zm23 0h15v16H47Zm23 0h7v16H70Z" /><path className="piece-detail" d="M42 43h16v26H42Z" /></>; break;
    case "q": body = <><path className="piece-silhouette" d="M29 68c-3-21 4-39 21-55 17 16 24 34 21 55Z" /><path className="piece-detail" d="m32 31 18 13 18-13M39 54h22" /><circle className="piece-silhouette" cx="50" cy="13" r="6" /></>; break;
    case "k": body = <><path className="piece-silhouette" d="M30 36 42 42l8-31 8 31 12-6-3 32H33Z" /><path className="piece-detail" d="M36 54h28M50 13v25M42 25h16" /></>; break;
  }
  return <>{body}{base}</>;
}

function CardPiece({ type }: { type: PieceSymbol }) {
  const symbols: Record<PieceSymbol, React.ReactNode> = {
    p: <><circle className="piece-detail" cx="50" cy="37" r="9" /><path className="piece-detail" d="M38 62c2-12 6-18 12-18s10 6 12 18Z" /></>,
    n: <path className="piece-detail" d="M34 61c3-15 8-26 18-34l-3-9 14 7 8 11-8 19-16 8Z" />,
    b: <><path className="piece-detail" d="M50 18c11 11 16 20 16 27 0 8-5 14-16 19-11-5-16-11-16-19 0-7 5-16 16-27Z" /><path className="piece-detail" d="m57 29-14 20" /></>,
    r: <><path className="piece-detail" d="M34 28h32v34H34Z" /><path className="piece-detail" d="M31 20h9v10h8V20h9v10h8V20h6" /></>,
    q: <><path className="piece-detail" d="m30 31 10 12 10-22 10 22 10-12-6 31H36Z" /><circle className="piece-detail-fill" cx="50" cy="18" r="3" /></>,
    k: <><path className="piece-detail" d="M50 17v24M39 28h22M34 62l6-24h20l6 24Z" /></>,
  };
  return <><rect className="piece-silhouette" x="22" y="8" width="56" height="82" rx="8" /><rect className="piece-detail" x="29" y="15" width="42" height="68" rx="4" />{symbols[type]}<circle className="piece-detail-fill" cx="34" cy="75" r="2" /><circle className="piece-detail-fill" cx="66" cy="75" r="2" /></>;
}

function IronPiece({ type }: { type: PieceSymbol }) {
  const base = <path className="piece-silhouette" d="M18 89 27 68h46l9 21Z" />;
  let body;
  switch (type) {
    case "p": body = <><path className="piece-silhouette" d="M34 65V31l16-16 16 16v34Z" /><path className="piece-detail" d="M50 16v49M38 40h24" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="M27 68c7-17 13-29 22-38l-5-16 18 10 11-7 7 18-15 9 6 24Z" /><path className="piece-detail" d="M53 31h14" /><circle className="piece-detail-fill" cx="63" cy="28" r="3" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="M32 67V18h36v49Z" /><path className="piece-detail" d="M42 18v49M58 18v49M32 33h36" /><path className="piece-silhouette" d="m50 10 16 8H34Z" /></>; break;
    case "r": body = <><path className="piece-silhouette" d="M25 25h50l-8 43H33Z" /><path className="piece-silhouette" d="M21 13h15v14H21Zm22 0h14v14H43Zm21 0h15v14H64Z" /><path className="piece-detail" d="M41 43h18v25H41Z" /></>; break;
    case "q": body = <><path className="piece-silhouette" d="M27 67 22 29l17 10 11-27 11 27 17-10-5 38Z" /><path className="piece-detail" d="M31 50h38M50 14v35" /></>; break;
    case "k": body = <><path className="piece-silhouette" d="M27 67 31 27l19-15 19 15 4 40Z" /><path className="piece-detail" d="M50 13v54M37 35h26M42 23h16" /></>; break;
  }
  return <>{body}{base}</>;
}

function ShogunPiece({ type }: { type: PieceSymbol }) {
  const base = <><path className="piece-silhouette" d="M18 87 28 70h44l10 17Z" /><path className="piece-detail" d="M25 80h50" /></>;
  let body;
  switch (type) {
    case "p": body = <><path className="piece-silhouette" d="M31 36c5-15 12-23 19-23s14 8 19 23l-8 31H39Z" /><path className="piece-detail" d="M34 35h32M42 24v20M58 24v20" /></>; break;
    case "n": body = <><path className="piece-silhouette" d="M25 64c9-8 15-19 18-32l-8-12 17 5 12-12 2 16 13 8-15 9 6 22H37Z" /><path className="piece-detail" d="M45 36h22" /><circle className="piece-detail-fill" cx="62" cy="32" r="3" /></>; break;
    case "b": body = <><path className="piece-silhouette" d="M50 11 72 34 62 67H38L28 34Z" /><path className="piece-detail" d="M50 12v55M36 35h28M40 48h20" /></>; break;
    case "r": body = <><path className="piece-silhouette" d="M27 31h46l-6 37H33Z" /><path className="piece-silhouette" d="m18 31 32-21 32 21Z" /><path className="piece-detail" d="M38 43h24M41 54h18M50 32v36" /></>; break;
    case "q": body = <><path className="piece-silhouette" d="M50 13c17 7 28 24 28 45-18-5-31-1-40 11-7-22-3-42 12-56Z" /><path className="piece-detail" d="M50 14c3 21-1 38-12 55M43 31l25 10M40 45l31 10" /></>; break;
    case "k": body = <><path className="piece-silhouette" d="M24 42 32 21l18 11 18-11 8 21-9 26H33Z" /><path className="piece-detail" d="M32 43h36M50 20v48M41 53h18" /><path className="piece-silhouette" d="m20 23 16 1-4 17Zm60 0-16 1 4 17Z" /></>; break;
  }
  return <>{body}{base}</>;
}

function NeonPiece({ type }: { type: PieceSymbol }) {
  const marks: Record<PieceSymbol, React.ReactNode> = {
    p: <><circle className="piece-detail" cx="50" cy="34" r="10" /><path className="piece-detail" d="M37 66 43 45h14l6 21Z" /></>,
    n: <path className="piece-detail" d="m34 64 8-30 11-14 17 9-8 9 7 26H52l-6-16" />,
    b: <><path className="piece-detail" d="m50 18 17 25-17 23-17-23Z" /><path className="piece-detail" d="m58 30-16 24" /></>,
    r: <><path className="piece-detail" d="M33 29h34v36H33Z" /><path className="piece-detail" d="M29 20h10v11h8V20h7v11h8V20h9" /></>,
    q: <path className="piece-detail" d="m29 31 12 13 9-26 9 26 12-13-7 34H36Z" />,
    k: <><path className="piece-detail" d="M50 16v28M39 29h22M33 66l7-24h20l7 24Z" /></>,
  };
  return <><path className="piece-silhouette" d="m50 6 35 20v48L50 94 15 74V26Z" /><path className="piece-detail" d="M15 50h13M72 50h13M50 6v11M50 83v11" />{marks[type]}<circle className="piece-detail-fill" cx="25" cy="50" r="3" /><circle className="piece-detail-fill" cx="75" cy="50" r="3" /></>;
}

function MonoPiece({ type }: { type: PieceSymbol }) {
  switch (type) {
    case "p": return <><circle className="piece-silhouette" cx="50" cy="27" r="13" /><path className="piece-silhouette" d="M35 70 43 41h14l8 29ZM22 83h56" /></>;
    case "n": return <><path className="piece-silhouette" d="m27 70 17-41 7-16 24 19-14 9 10 29Z" /><path className="piece-detail" d="m44 29 17 12M22 83h56" /></>;
    case "b": return <><path className="piece-silhouette" d="m50 12 20 32-20 27-20-27Z" /><path className="piece-detail" d="m59 27-18 27M22 83h56" /></>;
    case "r": return <><path className="piece-silhouette" d="M27 25h46v46H27ZM22 83h56" /><path className="piece-detail" d="M27 25V14h12v11M44 25V14h12v11M61 25V14h12v11" /></>;
    case "q": return <><path className="piece-silhouette" d="m22 25 15 20 13-33 13 33 15-20-9 47H31Z" /><path className="piece-detail" d="M22 83h56" /></>;
    case "k": return <><path className="piece-silhouette" d="M31 70 38 36h24l7 34ZM22 83h56" /><path className="piece-detail" d="M50 10v32M39 24h22" /></>;
  }
}

export function ThemedPieceArtwork({ type, theme }: { type: PieceSymbol; theme: ThemeId }) {
  switch (theme) {
    case "classic": return <ClassicPiece type={type} />;
    case "ocean": return <OceanPiece type={type} />;
    case "blockfield": return <RiotPiece type={type} />;
    case "toybox": return <ToyboxPiece type={type} />;
    case "arena-pop": return <ArenaPiece type={type} />;
    case "high-fantasy": return <FantasyPiece type={type} />;
    case "arcane-cards": return <CardPiece type={type} />;
    case "iron-legions": return <IronPiece type={type} />;
    case "shadow-shogun": return <ShogunPiece type={type} />;
    case "neon-grid": return <NeonPiece type={type} />;
    case "mono": return <MonoPiece type={type} />;
  }
}
