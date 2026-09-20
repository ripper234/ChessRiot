import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const accountIdSecret = "render-account-id-secret";

function platformIdentityHeaders(name = "Render Player") {
  const email = "render-player@players.chessriot.test";
  return {
    accept: "text/html",
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function renderEnv() {
  return {
    CHESSRIOT_ENV: "test",
    ACCOUNT_ID_SECRET: accountIdSecret,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

function assertMandatoryAccountGate(html) {
  assert.match(html, /פותחים את הזירה…|נכנסים ומשחקים/);
  assert.match(
    html,
    /<main(?=[^>]*class="auth-shell")(?=[^>]*lang="he")(?=[^>]*dir="rtl")(?=[^>]*translate="no")[^>]*>/,
  );
  assert.doesNotMatch(html, /OPENING THE ARENA|ASSEMBLING BOARD/i);
  assert.doesNotMatch(html, /Your display name|id="display-name"|Playing as|play as (?:a )?guest/i);
  if (/נכנסים ומשחקים/.test(html)) {
    assert.match(html, /המשך עם Google/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /href="\/privacy"/);
  }
}

test("renders the public home and mandatory account-gated play routes", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  const signedOutResponse = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(signedOutResponse.status, 200);
  assert.equal(signedOutResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(signedOutResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(signedOutResponse.headers.get("strict-transport-security"), null);
  const signedOutHtml = await signedOutResponse.text();
  const publicHomeSource = readFileSync(
    new URL("../app/ui/PublicHome.tsx", import.meta.url),
    "utf8",
  );
  assert.match(publicHomeSource, /REAL CHESS/);
  assert.match(publicHomeSource, /TOTAL PLAY/);
  assert.match(publicHomeSource, /href="\/app"/);
  assert.doesNotMatch(publicHomeSource, /href="\/demo"/);
  assert.match(publicHomeSource, /JOIN THE COMMUNITY ON WHATSAPP/);
  assert.doesNotMatch(publicHomeSource, /href="\/(?:privacy|terms)"/);
  assert.doesNotMatch(publicHomeSource, /Sign In to Play|CONTINUE WITH GOOGLE/i);
  if (/REAL CHESS/.test(signedOutHtml)) {
    assert.match(signedOutHtml, /TOTAL PLAY/);
    assert.match(signedOutHtml, /href="\/app"/);
    assert.doesNotMatch(signedOutHtml, /href="\/demo"/);
    assert.doesNotMatch(signedOutHtml, /href="\/(?:privacy|terms)"/);
  } else {
    assert.match(signedOutHtml, /home-resolving/);
  }
  assert.match(signedOutHtml, /<html(?![^>]*data-theme)[^>]*>/i);
  assert.doesNotMatch(signedOutHtml, /Playing as|SWITCH ACCOUNT/i);
  assert.doesNotMatch(signedOutHtml, /aria-label="Choose visual theme"/);
  assert.doesNotMatch(signedOutHtml, /human check|captcha|turnstile/i);

  const platformIdentifiedResponse = await worker.fetch(
    new Request("http://localhost/", { headers: platformIdentityHeaders("Ron Gross") }),
    renderEnv(),
    context,
  );
  assert.equal(platformIdentifiedResponse.status, 200);
  assert.equal(await platformIdentifiedResponse.text(), signedOutHtml);

  // Google session resolution is client-side. Verify the signed-in and public
  // root branches directly when SSR can only emit the resolving shell.
  const homeExperienceSource = readFileSync(
    new URL("../app/ui/HomeExperience.tsx", import.meta.url),
    "utf8",
  );
  const playerHomeSource = readFileSync(
    new URL("../app/ui/PlayerHome.tsx", import.meta.url),
    "utf8",
  );
  const tutorialSource = readFileSync(
    new URL("../app/ui/QuickStartTutorial.tsx", import.meta.url),
    "utf8",
  );
  const accountGateSource = readFileSync(
    new URL("../app/ui/AccountGate.tsx", import.meta.url),
    "utf8",
  );
  const privacyExportSource = readFileSync(
    new URL("../lib/privacy.ts", import.meta.url),
    "utf8",
  );
  const createGameSource = readFileSync(
    new URL("../app/ui/CreateGame.tsx", import.meta.url),
    "utf8",
  );
  const gameRoomSource = readFileSync(
    new URL("../app/ui/GameRoom.tsx", import.meta.url),
    "utf8",
  );
  const joinGameSource = readFileSync(
    new URL("../app/ui/JoinGame.tsx", import.meta.url),
    "utf8",
  );
  const activityInboxSource = readFileSync(
    new URL("../app/ui/ActivityInbox.tsx", import.meta.url),
    "utf8",
  );
  const feedbackFormSource = readFileSync(
    new URL("../app/ui/FeedbackButton.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    homeExperienceSource,
    /signedIn\s*\?\s*<AccountGate><PlayerHome\s*\/><\/AccountGate>\s*:\s*<PublicHome\s*\/>/s,
  );
  assert.match(homeExperienceSource, /fetchJsonWithReadTimeout<\{ signedIn\?: unknown \}>/);
  assert.match(playerHomeSource, /player-home-shell/);
  assert.match(playerHomeSource, /Your next move/);
  assert.match(playerHomeSource, /href="\/app\?mode=multiplayer">CHALLENGE A FRIEND/);
  assert.match(playerHomeSource, /href="\/app\?mode=solo">PLAY RIOT BOT/);
  assert.match(playerHomeSource, /Waiting for acceptance/);
  assert.match(playerHomeSource, /game\.outcome\.winner === game\.color \? "Won" : "Lost"/);
  assert.match(playerHomeSource, /window\.setInterval\(refreshVisible, 60_000\)/);
  assert.match(playerHomeSource, /window\.addEventListener\("focus", refreshVisible\)/);
  assert.match(playerHomeSource, /window\.addEventListener\("online", refreshVisible\)/);
  assert.match(playerHomeSource, /document\.addEventListener\("visibilitychange", refreshVisible\)/);
  assert.match(playerHomeSource, /fetchJsonWithReadTimeout<SocialPayload>/);
  assert.match(playerHomeSource, /generation !== refreshGeneration\.current/);
  assert.match(playerHomeSource, /ACTIVITY_CHANGED_EVENT, refreshAfterActivityChange/);
  assert.match(playerHomeSource, /קישור החברים שלך/);
  assert.match(playerHomeSource, /לא הזמנה למשחק פרטי/);
  assert.match(activityInboxSource, /searchParams\.get\("activity"\) !== "1"/);
  assert.match(activityInboxSource, /dialogRef\.current\?\.showModal\(\)/);
  assert.match(activityInboxSource, /ACTIVITY_POLL_MS = 30_000/);
  assert.match(activityInboxSource, /window\.addEventListener\("focus", refreshVisible\)/);
  assert.match(activityInboxSource, /window\.addEventListener\("online", refreshVisible\)/);
  assert.match(activityInboxSource, /window\.addEventListener\(ACTIVITY_CHANGED_EVENT, refreshVisible\)/);
  assert.match(activityInboxSource, /generation !== refreshGeneration\.current/);
  assert.match(activityInboxSource, /fetchJsonWithReadTimeout<ActivityPayload>/);
  assert.match(
    activityInboxSource,
    /className="activity-trigger"[\s\S]*?lang="he"\s*dir="rtl"\s*translate="no"/,
  );
  assert.match(
    readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"),
    /@media \(max-width: 980px\)[\s\S]*?\.player-home-actions \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(playerHomeSource, /Challenge received/);
  assert.match(playerHomeSource, /\/app\?mode=multiplayer&opponent=/);
  assert.match(playerHomeSource, /\/api\/games\/\$\{encodeURIComponent\(game\.id\)\}\/challenge/);
  assert.match(
    tutorialSource,
    /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*void finish\("skipped"\);\s*\}\}/s,
    "Escape must persist Skip instead of natively closing the pending tutorial",
  );
  assert.match(accountGateSource, /const \[tutorialOpen, setTutorialOpen\] = useState\(false\)/);
  assert.match(accountGateSource, /<ActivityInbox \/>\s*\{children\}\s*\{tutorialOpen \?/s);
  assert.doesNotMatch(playerHomeSource, /<ActivityInbox\b/);
  assert.match(
    accountGateSource,
    /<main className="auth-shell" lang="he" dir="rtl" translate="no">/,
  );
  assert.match(accountGateSource, /role="status">פותחים את הזירה…[\s\S]*?חזרה לדף הבית<\/Link><\/div>/);
  assert.doesNotMatch(accountGateSource, /OPENING THE ARENA/i);
  assert.doesNotMatch(accountGateSource, /state\.session\.tutorialStatus === "pending" \?/);
  assert.match(accountGateSource, /recoveryDelayMs/);
  assert.match(accountGateSource, /fetchJsonWithReadTimeout<SessionPayload>/);
  assert.match(accountGateSource, /if \(!response\.ok \|\| !data\) throw new Error\(\)/);
  assert.doesNotMatch(
    privacyExportSource,
    /LIMIT\s+(?:2000|100000)\b/,
    "account exports must not silently cap game or move history",
  );
  assert.match(privacyExportSource, /exportCompleteness:\s*\{\s*complete:\s*true/s);
  assert.match(createGameSource, /useState\(""\)/);
  assert.match(createGameSource, /placeholder="e\.g\. Knights move twice"/);
  assert.match(createGameSource, /"APPLY MAGIC"/);
  assert.match(createGameSource, /chessriot:magic-apply-draft:v1:/);
  assert.match(createGameSource, /Unfinished Apply restored/);
  assert.match(createGameSource, /requestMayStillBePending/);
  assert.match(createGameSource, /This is a connection or site-access error, not an invalid rule/);
  assert.match(createGameSource, /CREATE & SHARE INVITATION/);
  assert.match(createGameSource, /<strong>CHALLENGE A FRIEND<\/strong>/);
  assert.match(createGameSource, /WHO DO YOU WANT TO CHALLENGE\?/);
  assert.match(createGameSource, /Choose a friend or share a private invitation/);
  assert.match(createGameSource, /gamePathWithInvitation/);
  assert.match(createGameSource, /The game starts when (?:they|someone) accepts/);
  assert.match(createGameSource, /href="\/worlds"/);
  assert.match(tutorialSource, /setPractice\(selectTutorialKnight\)/);
  assert.match(tutorialSource, /moveTutorialKnight\(current, square\)/);
  assert.doesNotMatch(gameRoomSource, /className="magic-game-banner"/);
  assert.match(gameRoomSource, /className="side-card world-game-card"/);
  assert.match(gameRoomSource, /game\.magicRules \? "עולם" : "מידע"/);
  assert.match(gameRoomSource, /answerWaitingChallenge\("accept"\)/);
  assert.match(gameRoomSource, /אשר ושחק/);
  assert.match(gameRoomSource, /setPostGameDismissed\(true\);\s*focusBoardSquare\(focusedSquare\)/s);
  assert.match(gameRoomSource, /if \(!sidePanel\) return;[\s\S]*?sidePanelClose\.current\?\.focus/);
  assert.match(gameRoomSource, /readInvitationUrlFromHash/);
  assert.match(
    gameRoomSource,
    /if \(access === "loading"\)[\s\S]*?<main className="game-shell" lang="he" dir="rtl" translate="no">[\s\S]*?מסדרים את הלוח…/,
  );
  assert.doesNotMatch(gameRoomSource, /ASSEMBLING BOARD/i);
  assert.match(
    gameRoomSource,
    /className="chessboard"\s*dir="ltr"\s*role="grid"/,
    "the chessboard must preserve file order inside the Hebrew game shell",
  );
  assert.match(
    joinGameSource,
    /<main className="join-shell" lang="he" dir="rtl" translate="no">/,
  );
  assert.match(joinGameSource, /invite\.kind === "loading"[\s\S]*?פותח את ההזמנה…/);
  assert.doesNotMatch(joinGameSource, /OPENING THE ARENA/i);
  assert.match(
    joinGameSource,
    /const owned = await fetchJsonWithReadTimeout<\{ game\?: GameSnapshot \}>\([\s\S]*?`\/api\/games\/\$\{encodeURIComponent\(data\.gameId\)\}`/,
    "a claimed invitation must verify durable account membership before redirecting",
  );
  assert.doesNotMatch(
    joinGameSource,
    /\bfetch\(/,
    "invitation reads must keep the timeout active through JSON parsing",
  );
  assert.doesNotMatch(
    joinGameSource,
    /\bplayerKey\b/,
    "a stale seat token from another account must not block invitation acceptance",
  );
  assert.match(joinGameSource, /ללא מגבלת זמן למהלך/);
  assert.doesNotMatch(
    gameRoomSource,
    /ReactionPanel|\/reactions|openSidePanel\("reactions"|>React<|reaction-bubble/,
    "Quick Reactions must not return to the game UI",
  );
  assert.match(
    gameRoomSource,
    /!game\.turnPaceDays \? <PlayerClock game=\{clockGame\} color="w" \/> : null/,
  );
  assert.match(
    gameRoomSource,
    /!game\.turnPaceDays \? <PlayerClock game=\{clockGame\} color="b" \/> : null/,
  );
  assert.match(gameRoomSource, /detail:\s*\{ status: game\.status, mode: game\.mode \}/);
  const gameStyles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    gameStyles,
    /\.game-shell \.board-column > \.turn-deadline[\s\S]{0,100}display:\s*none/,
    "The day deadline must remain visible on mobile",
  );
  assert.match(
    gameStyles,
    /\.board-column:has\(> \.turn-deadline\) \.board-wrap\s*\{\s*width:\s*min\(calc\(100vw - 10px\), calc\(100dvh - 301px\)\)/,
    "Portrait games with a visible deadline must reserve its height",
  );
  assert.match(
    gameStyles,
    /\.board-column:has\(> \.turn-deadline\) \.board-wrap\s*\{\s*width:\s*min\(calc\(100vw - 68px\), calc\(100dvh - 169px\)\)/,
    "Short landscape games with a visible deadline must reserve its height",
  );

  const secureResponse = await worker.fetch(
    new Request("https://chessriot.gg/", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(secureResponse.status, 200);
  assert.equal(secureResponse.headers.get("strict-transport-security"), "max-age=86400");
  assert.doesNotMatch(
    secureResponse.headers.get("strict-transport-security") ?? "",
    /includeSubDomains/i,
  );

  const appHostResponse = await worker.fetch(
    new Request("http://app.localhost/", {
      headers: { accept: "text/html", host: "app.localhost" },
    }),
    renderEnv(),
    context,
  );
  assert.equal(appHostResponse.status, 200);
  const appHostHtml = await appHostResponse.text();
  assert.doesNotMatch(appHostHtml, /class="public-shell"/);
  assertMandatoryAccountGate(appHostHtml);
  assert.match(appHostHtml, /<html(?![^>]*data-theme)[^>]*>/i);

  const response = await worker.fetch(
    new Request("http://localhost/app", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot/);
  assertMandatoryAccountGate(html);
  assert.match(html, /מה חדש/);
  assert.match(
    html,
    new RegExp(`v(?:<!-- -->)?${packageJson.version.replaceAll(".", "\\.")}`),
  );
  assert.match(html, /פתיחת תפריט ChessRiot/);
  assert.match(html, /מראה וערכת עיצוב/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /https:\/\/chessriot\.gg\/(?:manifest|icons)\//);
  assert.doesNotMatch(html, /human check|captcha|turnstile/i);

  const appUpdatesSource = readFileSync(
    new URL("../app/ui/AppUpdates.tsx", import.meta.url),
    "utf8",
  );
  const appUpdatesStyles = readFileSync(
    new URL("../app/ui/AppUpdates.module.css", import.meta.url),
    "utf8",
  );
  const notificationPermissionSource = readFileSync(
    new URL("../lib/notification-permission.ts", import.meta.url),
    "utf8",
  );
  const globalStyles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(accountGateSource, /<h1>נכנסים ומשחקים<\/h1>/);
  assert.match(accountGateSource, /המשך עם Google/);
  assert.match(accountGateSource, /\/api\/auth\/google\/start/);
  assert.doesNotMatch(accountGateSource, /currently requires a registered Google account|play as (?:a )?guest/i);
  assert.match(accountGateSource, /<h1>בחירת שם משתמש<\/h1>/);
  assert.match(accountGateSource, /אותיות מכל שפה/);
  assert.match(accountGateSource, /לא ניתן לשנות אחר כך/);
  assert.match(accountGateSource, /kind: "notifications"/);
  assert.match(accountGateSource, /function NotificationOnboarding/);
  assert.match(accountGateSource, /לא מפספסים תור\./);
  assert.match(accountGateSource, /קבלו בקשות חברות, התראות תור/);
  assert.match(accountGateSource, /writeNotificationDecision\(payload\.account\.username, "onboarding"\)/);
  assert.match(accountGateSource, /registerPushDevice\(\{/);
  assert.match(accountGateSource, /writeNotificationDecision\(session\.username, "enabled"\)/);
  assert.match(accountGateSource, /localStorage\.setItem\(PUSH_DEVICE_OWNER_KEY, session\.username\)/);
  assert.match(accountGateSource, /לא חובה\. ההפעלה תפתח בקשת הרשאה/);
  assert.match(accountGateSource, /לא עכשיו/);
  assert.match(accountGateSource, /claimNotificationOnboardingFailOpen/);
  const notificationOnboardingSource = accountGateSource.match(
    /function NotificationOnboarding[\s\S]*$/,
  )?.[0];
  assert.ok(notificationOnboardingSource, "Missing optional notification onboarding");
  assert.doesNotMatch(notificationOnboardingSource, /Notification\.requestPermission/);
  assert.match(notificationOnboardingSource, /registerPushDevice\(\{/);
  assert.match(notificationOnboardingSource, /settlePushRegistrationChoice\(\{[\s\S]*?isCancelled: \(\) => setupCancelled\.current/);
  assert.match(notificationOnboardingSource, /if \(settled === "cancelled"\) return/);
  const signInScreenSource = accountGateSource.match(
    /function SignInScreen[\s\S]*?(?=function UsernameScreen)/,
  )?.[0];
  const usernameScreenSource = accountGateSource.match(
    /function UsernameScreen[\s\S]*$/,
  )?.[0];
  assert.match(usernameScreenSource, /autoComplete="off"/);
  assert.match(usernameScreenSource, /inputMode="text"/);
  assert.match(usernameScreenSource, /enterKeyHint="done"/);
  assert.match(usernameScreenSource, /dir="auto"/);
  assert.match(usernameScreenSource, /onBlur=\{\(\) => setValidationVisible\(true\)\}/);
  assert.match(usernameScreenSource, /aria-live="polite"/);
  assert.doesNotMatch(usernameScreenSource, /autoComplete="username"|pattern="\[A-Za-z/);
  for (const onboardingSource of [signInScreenSource, usernameScreenSource]) {
    assert.ok(onboardingSource, "Missing account onboarding screen");
    assert.match(onboardingSource, /className="auth-legal"/);
    assert.match(onboardingSource, /href="\/terms"/);
    assert.match(onboardingSource, /href="\/privacy"/);
  }
  assert.doesNotMatch(appUpdatesSource, /href="\/(?:privacy|terms)"/);
  assert.doesNotMatch(appUpdatesSource, /add this game to my account|account-link/i);
  assert.match(appUpdatesSource, /צפייה בהיסטוריית המשחקים/);
  assert.match(appUpdatesSource, /פתיחת הגדרות ChessRiot לטיפול בהתראות/);
  assert.match(appUpdatesSource, /enableTurnAlerts/);
  assert.match(appUpdatesSource, /Use Google Services for Push Messaging/);
  assert.match(appUpdatesSource, /notificationOfferDecisionKey/);
  assert.match(appUpdatesSource, /notificationDecisionKeepsPushSubscription/);
  assert.match(appUpdatesSource, /resumableNotificationDecision/);
  assert.match(appUpdatesSource, /runPushSetupStage/);
  assert.match(appUpdatesSource, /pushSetupTelemetryCode/);
  assert.match(appUpdatesSource, /pushSetupRecoveryMessage/);
  assert.doesNotMatch(appUpdatesSource, /storedDecision === "onboarding"[\s\S]*?"dismissed"/);
  assert.match(appUpdatesSource, /registerPushDevice\(\{/);
  assert.doesNotMatch(appUpdatesSource, /Don’t miss your turn\.|NOT NOW/);
  assert.match(appUpdatesSource, /\/api\/me\/push-devices/);
  assert.match(appUpdatesSource, /expectedUsername: username/);
  assert.match(appUpdatesSource, /turnAlertsBusy, turnAlertsRefresh/);
  assert.doesNotMatch(appUpdatesSource, /createdSubscription/);
  assert.match(appUpdatesSource, /התראות CHESSRIOT/);
  assert.match(appUpdatesSource, /קבלו בקשות חברות, התראות תור/);
  assert.match(appUpdatesSource, /בדיקת המכשיר הזה/);
  assert.match(appUpdatesSource, /\/api\/me\/push-devices\/test/);
  assert.match(appUpdatesSource, /התראות תור עדיין פעילות רק במשחקים ישנים/);
  assert.match(appUpdatesSource, /בדיקה חוזרת של ההתראות/);
  assert.match(appUpdatesSource, /className=\{styles\.notificationRecoveryBanner\}/);
  assert.match(
    appUpdatesSource,
    /const notificationRecoverySurface = mobileNotificationSurface \|\| androidPlatform;[\s\S]*?const showBlockedNotificationRecovery = Boolean\([\s\S]*?googleUsername[\s\S]*?notificationRecoverySurface[\s\S]*?notificationPermission === "denied"[\s\S]*?showNotificationSettingsBadge[\s\S]*?\);/,
  );
  assert.match(
    appUpdatesSource,
    /shouldBadgeAccountNotificationSettings\(\{[\s\S]*?mobile: notificationRecoverySurface,/,
  );
  assert.match(appUpdatesSource, /fetchJsonWithReadTimeout<unknown>\("\/api\/me\/push-devices\/test"/);
  assert.match(
    appUpdatesSource,
    /showNotificationSettingsBadge \? \([\s\S]*?className=\{styles\.notificationRecoveryBanner\}[\s\S]*?showBlockedNotificationRecovery[\s\S]*?openDialog[\s\S]*?enableTurnAlerts/,
  );
  assert.match(
    appUpdatesSource,
    /function openDialog\(\)[\s\S]*?notificationSettingsRef\.current\?\.scrollIntoView/,
  );
  assert.match(appUpdatesSource, /ההתראות חסומות במכשיר/);
  assert.match(appUpdatesSource, /הגדרות Android/);
  assert.match(appUpdatesSource, /אפליקציות ← Chrome/);
  assert.match(appUpdatesSource, /הגדרות אתרים ← התראות/);
  assert.match(appUpdatesSource, /setNotificationHostname\(window\.location\.hostname/);
  assert.match(appUpdatesSource, /<bdi dir="ltr">\{notificationHostname\}<\/bdi>/);
  assert.doesNotMatch(appUpdatesSource, /<bdi dir="ltr">chessriot\.gg<\/bdi>/);
  assert.match(appUpdatesSource, /בדקתי, נסו שוב/);
  assert.doesNotMatch(appUpdatesSource, /chrome:\/\//i);
  assert.doesNotMatch(appUpdatesSource, /intent:\/\//i);
  assert.match(
    appUpdatesSource,
    /<dialog[\s\S]*?lang="he"\s*dir="rtl"\s*translate="no"/,
  );
  assert.match(feedbackFormSource, /lang="he"[\s\S]*?dir="rtl"[\s\S]*?translate="no"/);
  assert.match(feedbackFormSource, /שליחת משוב/);
  assert.match(feedbackFormSource, /מה כדאי לשנות\?/);
  assert.match(feedbackFormSource, /requiredLabel="חובה"/);
  assert.match(feedbackFormSource, /צפייה בבעיות או שליחת בקשת שינוי/);
  assert.match(appUpdatesSource, /className=\{styles\.turnAlertBadge\}/);
  assert.match(appUpdatesSource, /shouldBadgeAccountNotificationSettings/);
  assert.match(appUpdatesSource, /PUSH_DEVICE_OWNER_KEY/);
  assert.match(appUpdatesSource, /registration\.unregister\(\)/);
  assert.match(appUpdatesSource, /setPushConsentEnabled\(false\)/);
  assert.match(appUpdatesStyles, /\.turnAlertBadge\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(appUpdatesStyles, /\.notificationRecoveryBanner\s*\{[\s\S]*?position:\s*relative/);
  assert.match(
    appUpdatesStyles,
    /\.notificationRecoveryBanner\s*\{[^}]*margin:\s*calc\(max\(12px, env\(safe-area-inset-top\)\) \+ 58px\) auto 12px/,
  );
  assert.doesNotMatch(appUpdatesStyles, /\.notificationOutcome\s*\{/);
  assert.doesNotMatch(appUpdatesSource, /className=\{styles\.notificationOutcome\}/);
  assert.doesNotMatch(appUpdatesSource, /Notifications are allowed, but setup did not finish/);
  assert.match(notificationPermissionSource, /NOTIFICATION_PERMISSION_ATTEMPT_KEY/);
  assert.match(notificationPermissionSource, /NOTIFICATION_ONBOARDING_SEEN_KEY/);
  assert.match(notificationPermissionSource, /!input\.onboardingSeen/);
  assert.match(notificationPermissionSource, /recordNotificationPermissionAttempt\("started"/);
  assert.match(notificationPermissionSource, /if \(automatic && notificationPermissionWasAttempted/);
  assert.match(notificationPermissionSource, /navigator\.locks/);
  assert.match(notificationPermissionSource, /NOTIFICATION_PERMISSION_LOCK/);
  assert.match(notificationPermissionSource, /requestPermission: \(\) => Notification\.requestPermission\(\)/);
  assert.doesNotMatch(accountGateSource, /Notification\.requestPermission\(\).*useEffect/s);
  assert.doesNotMatch(appUpdatesStyles, /\.turnAlertPrompt|z-index:\s*43/);

  const authHeadingRule = globalStyles.match(/\.auth-card h1\s*\{([^}]*)\}/)?.[1];
  assert.ok(authHeadingRule, "Missing compact account-gate heading rule");
  const authHeadingClamp = authHeadingRule.match(/clamp\([^,]+,[^,]+,\s*(\d+(?:\.\d+)?)px\)/);
  assert.ok(authHeadingClamp, "Account-gate heading must use a bounded responsive size");
  assert.ok(Number(authHeadingClamp[1]) <= 42, "Sign-in heading is too large");
  const authLegalRule = globalStyles.match(/\.auth-legal\s*\{([^}]*)\}/)?.[1];
  assert.ok(authLegalRule, "Missing subtle registration legal copy styling");
  assert.match(authLegalRule, /font:[^;]*\b(?:9|10|11)px\//);

  const gameResponse = await worker.fetch(
    new Request("http://localhost/g/00000000-0000-4000-8000-000000000000", {
      headers: { accept: "text/html" },
    }),
    renderEnv(),
    context,
  );
  assert.equal(gameResponse.status, 200);
  const gameHtml = await gameResponse.text();
  assertMandatoryAccountGate(gameHtml);
  assert.match(gameHtml, /<html(?![^>]*data-theme)[^>]*>/i);
  assert.match(gameHtml, /פתיחת תפריט ChessRiot/);
  assert.match(gameHtml, /מראה וערכת עיצוב/);
  assert.doesNotMatch(gameHtml, /name="menu-theme"/);
  assert.doesNotMatch(gameHtml, /class="global-version"/);
  assert.doesNotMatch(gameHtml, /LOCKING MOVE/);
  assert.match(
    gameHtml,
    /<a(?=[^>]*href="https:\/\/chat\.whatsapp\.com\/FaBgiUgl73vLdeqzcqx0vX")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>/,
  );
  assert.match(gameHtml, /הצטרפות לקהילת WhatsApp/);

  const joinResponse = await worker.fetch(
    new Request(`http://localhost/join/${"a".repeat(43)}`, {
      headers: { accept: "text/html" },
    }),
    renderEnv(),
    context,
  );
  assert.equal(joinResponse.status, 200);
  const joinHtml = await joinResponse.text();
  assertMandatoryAccountGate(joinHtml);
  assert.match(joinHtml, /<html(?![^>]*data-theme)[^>]*>/i);
});

test("renders the production capture lab and keeps combat non-blocking", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `capture-lab-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/capture-lab", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /EVERY PIECE/);
  assert.match(html, /FIGHTS DIFFERENT/);
  assert.match(html, /Sword slash/);
  assert.match(html, /SIMULATE REDUCED MOTION/);

  const gameRoomSource = readFileSync(
    new URL("../app/ui/GameRoom.tsx", import.meta.url),
    "utf8",
  );
  const combatStyles = readFileSync(
    new URL("../app/combat.css", import.meta.url),
    "utf8",
  );
  assert.match(gameRoomSource, /<BoardActionAnimation/);
  assert.match(gameRoomSource, /dismissBoardEffects/);
  assert.doesNotMatch(gameRoomSource, /aria-busy=.*activeEffect/);
  assert.doesNotMatch(gameRoomSource, /disabled=.*activeEffect/);
  for (const piece of ["p", "n", "b", "r", "q", "k"]) {
    assert.match(combatStyles, new RegExp(`data-attacker=\\"${piece}\\"`));
  }
});

test("renders identity-independent Privacy and Terms pages", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `legal-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  for (const [path, title, link] of [
    ["/privacy", "PRIVACY", "/terms"],
    ["/terms", "TERMS", "/privacy"],
  ]) {
    const anonymous = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
      renderEnv(),
      context,
    );
    const identified = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: platformIdentityHeaders() }),
      renderEnv(),
      context,
    );
    assert.equal(anonymous.status, 200);
    assert.equal(identified.status, 200);
    const html = await anonymous.text();
    assert.equal(await identified.text(), html);
    assert.match(html, new RegExp(`>${title}<`));
    assert.match(html, new RegExp(`href="${link}"`));
    assert.doesNotMatch(html, /private seat link[^<]*[A-Za-z0-9_-]{43}/i);
  }
});

test("keeps the version inside the unified menu and no locking label", () => {
  const gameRoomSource = readFileSync(
    new URL("../app/ui/GameRoom.tsx", import.meta.url),
    "utf8",
  );
  const routeChromeSource = readFileSync(
    new URL("../app/ui/RouteChrome.tsx", import.meta.url),
    "utf8",
  );
  const globalStyles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const healthSource = readFileSync(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gameRoomSource, /game-version/);
  assert.doesNotMatch(gameRoomSource, /LOCKING MOVE/);
  assert.match(
    gameRoomSource,
    /surrenderDialog\.current\?\.close\(\);[\s\S]*setSurrendering\(true\)/,
  );
  assert.match(gameRoomSource, /aria-controls="coach-risk-explanation"/);
  assert.match(gameRoomSource, /const surrenderKeepPlaying = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(
    gameRoomSource,
    /dialog\.showModal\(\);\s*surrenderKeepPlaying\.current\?\.focus\(\)/,
  );
  assert.match(gameRoomSource, /ref=\{surrenderKeepPlaying\}/);
  assert.doesNotMatch(routeChromeSource, /global-version/);
  assert.match(routeChromeSource, /<AppUpdates/);
  assert.match(globalStyles, /surrender-confirm/);
  assert.match(globalStyles, /\.privacy-shell > \.topbar/);
  assert.doesNotMatch(globalStyles, /\.move-confirm-card > div/);
  assert.doesNotMatch(healthSource, /ensureSchema/);
});

test("renders the narrated 90-second demo page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `demo-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/demo", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot in 90 seconds/);
  assert.match(html, /1:30 STORY/);
  assert.match(html, /SYNTHETIC NARRATION/);
  assert.match(html, /src="\/demo-assets\/chessriot-demo\.mp4"/);
  assert.match(html, /controls/);
  assert.match(html, /playsInline/);
  assert.match(html, /READ VIDEO TRANSCRIPT/);
  assert.match(html, /Ron and Omri want chess/);
  assert.match(html, /One game, still moving/);
  assert.doesNotMatch(html, /90 SECONDS\.<br/);
  assert.match(html, /Magic Rules stay Coming Soon/);
  assert.match(html, /The narration voice is synthetic/);
  assert.match(html, /noindex/i);
  assert.doesNotMatch(html, /INTERPRET RULES|COMPILE RULES/);
});

test("publishes crawler policy and a working favicon route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `public-metadata-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };

  const robots = await worker.fetch(
    new Request("http://localhost/robots.txt"),
    renderEnv(),
    context,
  );
  assert.equal(robots.status, 200);
  const policy = await robots.text();
  assert.match(policy, /Disallow: \/api\//);
  assert.match(policy, /Disallow: \/g\//);
  assert.match(policy, /Disallow: \/verify/);
  assert.match(policy, /Allow: \/terms/);
  assert.match(policy, /Sitemap: https:\/\/chessriot\.gg\/sitemap\.xml/);

  const sitemap = await worker.fetch(
    new Request("http://localhost/sitemap.xml"),
    renderEnv(),
    context,
  );
  assert.equal(sitemap.status, 200);
  const sitemapText = await sitemap.text();
  assert.match(sitemapText, /https:\/\/chessriot\.gg\/terms/);
  assert.doesNotMatch(sitemapText, /https:\/\/chessriot\.gg\/demo/);

  const favicon = await worker.fetch(
    new Request("http://localhost/favicon.ico", { redirect: "manual" }),
    renderEnv(),
    context,
  );
  assert.equal(favicon.status, 308);
  assert.equal(new URL(favicon.headers.get("location")).pathname, "/icons/chessriot-192.png");
});

test("retires the old verification and human-check routes", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `verify-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  const env = renderEnv();

  const verifyResponse = await worker.fetch(
    new Request("http://localhost/verify?return_to=%2F", { redirect: "manual" }),
    env,
    context,
  );
  assert.ok([303, 307, 308].includes(verifyResponse.status));
  assert.equal(new URL(verifyResponse.headers.get("location"), "http://localhost").pathname, "/app");

  const retiredRoute = await worker.fetch(
    new Request("http://localhost/api/auth/captcha", {
      method: "POST",
      headers: platformIdentityHeaders(),
    }),
    env,
    context,
  );
  assert.equal(retiredRoute.status, 404);
});

test("renders the newest-first public changelog", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `changelog-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/changelog", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WHAT.*NEW/);
  const normalizedHtml = html.replaceAll("<!-- -->", "");
  const currentVersionIndex = normalizedHtml.indexOf(`v${packageJson.version}`);
  assert.ok(currentVersionIndex >= 0);
  for (const version of ["v0.3.5", "v0.3.4", "v0.3.3", "v0.3.2", "v0.3.1"]) {
    assert.ok(normalizedHtml.indexOf(version) >= 0);
  }
  assert.ok(currentVersionIndex < normalizedHtml.indexOf("v0.3.5"));
  assert.ok(normalizedHtml.indexOf("v0.3.5") < normalizedHtml.indexOf("v0.3.4"));
  assert.ok(normalizedHtml.indexOf("v0.3.3") < normalizedHtml.indexOf("v0.3.2"));
  assert.ok(normalizedHtml.indexOf("v0.3.2") < normalizedHtml.indexOf("v0.3.1"));
  assert.ok(normalizedHtml.indexOf("v0.3.1") < normalizedHtml.indexOf("v0.3.0"));
  assert.match(html, /github\.com\/ripper234\/ChessRiot/);
});
