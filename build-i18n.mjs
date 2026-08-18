// Language configuration and interface copy for the Urdu and Pashto editions.
//
// Article text is machine-translated in the Worker and stored in D1. The strings
// here are the site's own furniture — navigation, section headings, button
// labels — and are written by hand instead, because a reader judges a language
// edition by whether the chrome reads naturally, and because these strings must
// stay byte-stable across builds for the asset digests to hold.
//
// Adding a language: add an entry to LOCALES with a full `strings` block, add
// its code to the Worker's LANGUAGES in worker/src/translate.js, and the build
// picks up the new tree automatically.

const EN = {
  siteTagline: "Tracking terror threats in Pakistan and the wider region.",
  siteDescription:
    "Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.",

  navNews: "News",
  navOpinion: "Opinion",
  navMonitoring: "Monitoring",
  navIncidentMap: "Incident Map",
  navNetworkGraph: "Network Graph",
  navReports: "Reports",
  navContact: "Contact",
  navPrimaryLabel: "Primary navigation",

  homeTitle: "The Global Decipher",
  homeEyebrow: "Latest coverage",
  homeSummary:
    "Research-first reporting on terrorism, militant networks, and security risk across Pakistan and the wider region.",

  newsTitle: "News & Analysis",
  newsEyebrow: "Public briefings",
  newsSummary:
    "Timely coverage and analytical notes on terrorism, counterterrorism, and regional security developments.",
  opinionTitle: "Opinion",
  opinionEyebrow: "Commentary",
  opinionSummary:
    "Perspective essays and expert commentary on security policy, propaganda, and conflict trends.",
  reportsTitle: "Reports",
  reportsEyebrow: "Research products",
  reportsSummary:
    "Monthly summaries, trend reviews, and premium research previews for institutional readers.",
  profilesTitle: "Terrorist Profiles",
  profilesEyebrow: "Actor database",
  profilesSummary:
    "Searchable research profiles on militant leaders, organisations, status, ideology, and operating areas.",

  typeNews: "News & Analysis",
  typeOpinion: "Opinion",
  typeMonitoring: "Monitoring Desk",
  typeReports: "Report",
  typeProfiles: "Profile",
  typePage: "Page",

  badgePaid: "Paid access",
  badgePremium: "Premium preview",
  badgeResearch: "Public source",
  badgeFree: "Free",

  byline: "By",
  deskName: "TGD Desk",
  regionGlobal: "Global",
  relatedEyebrow: "Related reading",
  relatedTitle: "Continue research",

  sidebarGlance: "At a glance",
  sidebarFacts: "Profile facts",
  sidebarToc: "On this page",
  sidebarTocLabel: "Article sections",
  sidebarFiles: "Files",
  sidebarTags: "Tags",
  sidebarResearchNote: "Research note",
  sidebarResearchBody:
    "Public-source profile. TGD excludes operational guidance and treats uncertain current-status claims separately.",
  sidebarShare: "Share",
  sidebarCopyLink: "Copy link",
  downloadPdf: "Download PDF",

  searchLabel: "Search",
  searchAll: "All",
  searchPlaceholder: "Search by region, actor, theme, or report",
  headerSearchLabel: "Search TGD",
  headerSearchPlaceholder: "Search reports, profiles, regions, groups, or themes",
  themeToggleLabel: "Switch color theme",
  menuLabel: "Open menu",
  homeAria: "home",
  skipToContent: "Skip to content",

  emptyFiltered: "No matching briefings found.",
  emptyNone: "No published items yet. New uploads will appear here.",
  ctaEyebrow: "Editorial desk",
  ctaHeadline: "{title} is being built out.",
  ctaBody:
    "New briefings will appear here as the desk publishes. Follow the WhatsApp channel or pitch the desk with relevant public-source material.",
  ctaWhatsapp: "WhatsApp channel",
  ctaPitch: "Pitch the desk",

  premiumTitle: "Request full access",
  premiumBody:
    "This is a public preview. Full Monitoring Desk notes and premium reports are handled manually for subscribers and institutional clients.",
  premiumCta: "Contact TGD",

  footerChannels: "Channels",
  footerX: "X / Twitter",
  footerWhatsapp: "WhatsApp Channel",
  footerSubstack: "Substack",
  footerEditorial: "Editorial",
  footerMethodology: "Methodology",
  footerCorrections: "Corrections",
  footerPrivacy: "Privacy",
  footerPitch: "Pitch & Contact",
  footerContact: "Contact desk",
  footerAbout: "About TGD",
  footerRights: "The Global Decipher · Independent research",
  footerNote: "Public-interest reporting · No propaganda amplification",

  notFoundTitle: "Page not found",
  notFoundHeadline: "This page is not in the archive.",
  notFoundBody: "The link may have moved, or the briefing may not have been published yet.",
  notFoundHome: "Return home",
  notFoundContact: "Contact the desk",

  languageLabel: "Language",
  translationNoticeTitle: "Machine translation",
  translationNotice:
    "This article was translated automatically from the English original. The English version is authoritative; please report any error to the desk.",
  readInEnglish: "Read the English original"
};

const UR = {
  siteTagline: "پاکستان اور خطے میں دہشت گردی کے خطرات کی نگرانی۔",
  siteDescription:
    "دہشت گردی، عسکریت پسند نیٹ ورکس اور سلامتی کے خطرات پر آزاد، تحقیق پر مبنی رپورٹنگ — بنیادی توجہ پاکستان پر، علاقائی اور عالمی تناظر کے ساتھ۔",

  navNews: "خبریں",
  navOpinion: "رائے",
  navMonitoring: "نگرانی",
  navIncidentMap: "واقعات کا نقشہ",
  navNetworkGraph: "نیٹ ورک گراف",
  navReports: "رپورٹس",
  navContact: "رابطہ",
  navPrimaryLabel: "بنیادی نیویگیشن",

  homeTitle: "دی گلوبل ڈیسائفر",
  homeEyebrow: "تازہ ترین رپورٹنگ",
  homeSummary:
    "پاکستان اور وسیع تر خطے میں دہشت گردی، عسکریت پسند نیٹ ورکس اور سلامتی کے خطرات پر تحقیق پر مبنی رپورٹنگ۔",

  newsTitle: "خبریں اور تجزیہ",
  newsEyebrow: "عوامی بریفنگز",
  newsSummary:
    "دہشت گردی، انسدادِ دہشت گردی اور علاقائی سلامتی کی پیش رفت پر بروقت رپورٹنگ اور تجزیاتی نوٹس۔",
  opinionTitle: "رائے",
  opinionEyebrow: "تبصرہ",
  opinionSummary:
    "سلامتی کی پالیسی، پروپیگنڈا اور تنازعات کے رجحانات پر تجزیاتی مضامین اور ماہرانہ تبصرہ۔",
  reportsTitle: "رپورٹس",
  reportsEyebrow: "تحقیقی مصنوعات",
  reportsSummary:
    "ادارہ جاتی قارئین کے لیے ماہانہ خلاصے، رجحانات کے جائزے اور پریمیم تحقیقی جھلکیاں۔",
  profilesTitle: "دہشت گرد پروفائلز",
  profilesEyebrow: "کرداروں کا ڈیٹابیس",
  profilesSummary:
    "عسکریت پسند رہنماؤں، تنظیموں، ان کی حیثیت، نظریے اور دائرہ کار پر قابلِ تلاش تحقیقی پروفائلز۔",

  typeNews: "خبریں اور تجزیہ",
  typeOpinion: "رائے",
  typeMonitoring: "نگرانی ڈیسک",
  typeReports: "رپورٹ",
  typeProfiles: "پروفائل",
  typePage: "صفحہ",

  badgePaid: "ادائیگی شدہ رسائی",
  badgePremium: "پریمیم جھلک",
  badgeResearch: "عوامی ذرائع",
  badgeFree: "مفت",

  byline: "تحریر:",
  deskName: "ٹی جی ڈی ڈیسک",
  regionGlobal: "عالمی",
  relatedEyebrow: "متعلقہ مطالعہ",
  relatedTitle: "تحقیق جاری رکھیں",

  sidebarGlance: "ایک نظر میں",
  sidebarFacts: "پروفائل کے حقائق",
  sidebarToc: "اس صفحے پر",
  sidebarTocLabel: "مضمون کے حصے",
  sidebarFiles: "فائلیں",
  sidebarTags: "ٹیگز",
  sidebarResearchNote: "تحقیقی نوٹ",
  sidebarResearchBody:
    "عوامی ذرائع پر مبنی پروفائل۔ ٹی جی ڈی عملی رہنمائی شامل نہیں کرتا اور موجودہ حیثیت کے غیر مصدقہ دعووں کو الگ رکھتا ہے۔",
  sidebarShare: "شیئر کریں",
  sidebarCopyLink: "لنک کاپی کریں",
  downloadPdf: "پی ڈی ایف ڈاؤن لوڈ کریں",

  searchLabel: "تلاش",
  searchAll: "تمام",
  searchPlaceholder: "خطے، کردار، موضوع یا رپورٹ کے ذریعے تلاش کریں",
  headerSearchLabel: "ٹی جی ڈی میں تلاش کریں",
  headerSearchPlaceholder: "رپورٹس، پروفائلز، خطے، گروہ یا موضوعات تلاش کریں",
  themeToggleLabel: "رنگ کی تھیم تبدیل کریں",
  menuLabel: "مینو کھولیں",
  homeAria: "صفحۂ اول",
  skipToContent: "مواد پر جائیں",

  emptyFiltered: "کوئی مماثل بریفنگ نہیں ملی۔",
  emptyNone: "ابھی کوئی شائع شدہ مواد نہیں۔ نئی اشاعتیں یہاں ظاہر ہوں گی۔",
  ctaEyebrow: "ادارتی ڈیسک",
  ctaHeadline: "{title} پر کام جاری ہے۔",
  ctaBody:
    "ڈیسک کی اشاعت کے ساتھ نئی بریفنگز یہاں ظاہر ہوں گی۔ واٹس ایپ چینل فالو کریں یا متعلقہ عوامی مواد کے ساتھ ڈیسک سے رابطہ کریں۔",
  ctaWhatsapp: "واٹس ایپ چینل",
  ctaPitch: "ڈیسک کو تجویز بھیجیں",

  premiumTitle: "مکمل رسائی کی درخواست کریں",
  premiumBody:
    "یہ ایک عوامی جھلک ہے۔ مکمل نگرانی ڈیسک نوٹس اور پریمیم رپورٹس سبسکرائبرز اور ادارہ جاتی کلائنٹس کے لیے الگ سے فراہم کی جاتی ہیں۔",
  premiumCta: "ٹی جی ڈی سے رابطہ کریں",

  footerChannels: "چینلز",
  footerX: "ایکس / ٹوئٹر",
  footerWhatsapp: "واٹس ایپ چینل",
  footerSubstack: "سب اسٹیک",
  footerEditorial: "ادارتی",
  footerMethodology: "طریقۂ کار",
  footerCorrections: "تصحیحات",
  footerPrivacy: "رازداری",
  footerPitch: "تجویز اور رابطہ",
  footerContact: "ڈیسک سے رابطہ",
  footerAbout: "ٹی جی ڈی کے بارے میں",
  footerRights: "دی گلوبل ڈیسائفر · آزاد تحقیق",
  footerNote: "عوامی مفاد کی رپورٹنگ · پروپیگنڈے کی تشہیر نہیں",

  notFoundTitle: "صفحہ نہیں ملا",
  notFoundHeadline: "یہ صفحہ آرکائیو میں موجود نہیں۔",
  notFoundBody: "ممکن ہے لنک تبدیل ہو گیا ہو، یا بریفنگ ابھی شائع نہ ہوئی ہو۔",
  notFoundHome: "صفحۂ اول پر واپس",
  notFoundContact: "ڈیسک سے رابطہ",

  languageLabel: "زبان",
  translationNoticeTitle: "مشینی ترجمہ",
  translationNotice:
    "یہ مضمون انگریزی اصل سے خودکار طور پر ترجمہ کیا گیا ہے۔ سند انگریزی متن کو حاصل ہے؛ کسی غلطی کی نشاندہی ڈیسک کو کریں۔",
  readInEnglish: "انگریزی اصل پڑھیں"
};

const PS = {
  siteTagline: "په پاکستان او سیمه کې د ترهګرۍ ګواښونو څارنه.",
  siteDescription:
    "د ترهګرۍ، وسله والو شبکو او امنیتي ګواښونو په اړه خپلواکه، څېړنې پر بنسټ راپورونه — تمرکز پاکستان، له سیمه ییز او نړیوال شالید سره.",

  navNews: "خبرونه",
  navOpinion: "نظر",
  navMonitoring: "څارنه",
  navIncidentMap: "د پېښو نقشه",
  navNetworkGraph: "د شبکې ګراف",
  navReports: "راپورونه",
  navContact: "اړیکه",
  navPrimaryLabel: "اصلي لارښود",

  homeTitle: "ګلوبل ډیسایفر",
  homeEyebrow: "وروستي راپورونه",
  homeSummary:
    "په پاکستان او پراخه سیمه کې د ترهګرۍ، وسله والو شبکو او امنیتي ګواښونو په اړه څېړنې پر بنسټ راپورونه.",

  newsTitle: "خبرونه او شننه",
  newsEyebrow: "عامه لنډیزونه",
  newsSummary:
    "د ترهګرۍ، د ترهګرۍ ضد هڅو او سیمه ییزو امنیتي پرمختګونو په اړه پر وخت راپورونه او تحلیلي یادښتونه.",
  opinionTitle: "نظر",
  opinionEyebrow: "تبصره",
  opinionSummary:
    "د امنیتي پالیسۍ، پروپاګند او د شخړو د بهیرونو په اړه تحلیلي لیکنې او د کارپوهانو تبصرې.",
  reportsTitle: "راپورونه",
  reportsEyebrow: "څېړنیز محصولات",
  reportsSummary:
    "د ادارو لپاره میاشتني لنډیزونه، د بهیرونو کتنې او پریمیم څېړنیزې کتنې.",
  profilesTitle: "د ترهګرو پېژندپاڼې",
  profilesEyebrow: "د کړونکو ډیټابیس",
  profilesSummary:
    "د وسله والو مشرانو، سازمانونو، د هغوی د حالت، ایډیالوژۍ او د فعالیت د سیمو په اړه د لټون وړ څېړنیزې پېژندپاڼې.",

  typeNews: "خبرونه او شننه",
  typeOpinion: "نظر",
  typeMonitoring: "د څارنې ډیسک",
  typeReports: "راپور",
  typeProfiles: "پېژندپاڼه",
  typePage: "پاڼه",

  badgePaid: "تادیه شوی لاسرسی",
  badgePremium: "پریمیم کتنه",
  badgeResearch: "عامه سرچینه",
  badgeFree: "وړیا",

  byline: "لیکوال:",
  deskName: "د TGD ډیسک",
  regionGlobal: "نړیوال",
  relatedEyebrow: "اړوند لوستل",
  relatedTitle: "څېړنې ته دوام ورکړئ",

  sidebarGlance: "په یوه کتنه",
  sidebarFacts: "د پېژندپاڼې حقایق",
  sidebarToc: "په دې پاڼه کې",
  sidebarTocLabel: "د لیکنې برخې",
  sidebarFiles: "دوتنې",
  sidebarTags: "ټګونه",
  sidebarResearchNote: "د څېړنې یادښت",
  sidebarResearchBody:
    "پر عامه سرچینو ولاړه پېژندپاڼه. TGD عملیاتي لارښوونې نه شاملوي او د اوسني حالت ناڅرګند ادعاوې جلا ګڼي.",
  sidebarShare: "شریکول",
  sidebarCopyLink: "لینک کاپي کړئ",
  downloadPdf: "PDF ښکته کړئ",

  searchLabel: "لټون",
  searchAll: "ټول",
  searchPlaceholder: "د سیمې، کړونکي، موضوع یا راپور له مخې ولټوئ",
  headerSearchLabel: "په TGD کې لټون",
  headerSearchPlaceholder: "راپورونه، پېژندپاڼې، سیمې، ډلې یا موضوعات ولټوئ",
  themeToggleLabel: "د رنګ بڼه بدله کړئ",
  menuLabel: "مینو پرانیستل",
  homeAria: "کورپاڼه",
  skipToContent: "منځپانګې ته ورشئ",

  emptyFiltered: "هیڅ اړونده لنډیز ونه موندل شو.",
  emptyNone: "تر اوسه هیڅ خپور شوی توکی نشته. نوي خپرونې به دلته ښکاره شي.",
  ctaEyebrow: "ادارتي ډیسک",
  ctaHeadline: "پر {title} کار روان دی.",
  ctaBody:
    "څنګه چې ډیسک خپروي، نوي لنډیزونه به دلته ښکاره شي. د واټساپ چینل تعقیب کړئ یا د اړوندو عامه موادو سره له ډیسک سره اړیکه ونیسئ.",
  ctaWhatsapp: "د واټساپ چینل",
  ctaPitch: "ډیسک ته وړاندیز واستوئ",

  premiumTitle: "د بشپړ لاسرسي غوښتنه",
  premiumBody:
    "دا یوه عامه کتنه ده. د څارنې ډیسک بشپړ یادښتونه او پریمیم راپورونه د ګډونوالو او ادارو لپاره په جلا توګه چمتو کیږي.",
  premiumCta: "له TGD سره اړیکه",

  footerChannels: "چینلونه",
  footerX: "ایکس / ټویټر",
  footerWhatsapp: "د واټساپ چینل",
  footerSubstack: "سب سټاک",
  footerEditorial: "ادارتي",
  footerMethodology: "کړنلاره",
  footerCorrections: "سمونونه",
  footerPrivacy: "محرمیت",
  footerPitch: "وړاندیز او اړیکه",
  footerContact: "له ډیسک سره اړیکه",
  footerAbout: "د TGD په اړه",
  footerRights: "ګلوبل ډیسایفر · خپلواکه څېړنه",
  footerNote: "د عامه ګټو راپورونه · د پروپاګند خپرول نه",

  notFoundTitle: "پاڼه ونه موندل شوه",
  notFoundHeadline: "دا پاڼه په ارشیف کې نشته.",
  notFoundBody: "کېدای شي لینک بدل شوی وي، یا لنډیز لا خپور شوی نه وي.",
  notFoundHome: "کورپاڼې ته ورشئ",
  notFoundContact: "له ډیسک سره اړیکه",

  languageLabel: "ژبه",
  translationNoticeTitle: "ماشیني ژباړه",
  translationNotice:
    "دا لیکنه له انګلیسي اصل څخه په اتوماتيک ډول ژباړل شوې. انګلیسي بڼه معتبره ده؛ که کومه تېروتنه ووینئ، ډیسک ته یې ووایاست.",
  readInEnglish: "انګلیسي اصل ولولئ"
};

export const LOCALES = {
  en: { code: "en", htmlLang: "en", dir: "ltr", prefix: "", label: "English", englishName: "English", strings: EN },
  ur: { code: "ur", htmlLang: "ur", dir: "rtl", prefix: "/ur", label: "اردو", englishName: "Urdu", strings: UR },
  ps: { code: "ps", htmlLang: "ps", dir: "rtl", prefix: "/ps", label: "پښتو", englishName: "Pashto", strings: PS }
};

export const DEFAULT_LOCALE = LOCALES.en;
export const TRANSLATED_LOCALES = ["ur", "ps"];
export const LOCALE_CODES = Object.keys(LOCALES);

// Google's Noto families are the only widely available webfonts that render
// Nastaliq Urdu and Pashto Naskh correctly; the system fallbacks on Windows and
// Android otherwise drop to a Latin face that cannot shape the script at all.
export const RTL_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400..700&family=Noto+Naskh+Arabic:wght@400..700&display=swap";

// "/news/" in the Urdu tree is "/ur/news/". The English tree keeps the bare
// paths it has always had, so no existing URL moves and nothing needs redirecting.
export function localePath(urlPath, locale) {
  const prefix = locale?.prefix || "";
  if (!prefix) return urlPath;
  if (urlPath === "/") return `${prefix}/`;
  return `${prefix}${urlPath}`;
}

export function localeFor(code) {
  return LOCALES[String(code || "en").toLowerCase()] || DEFAULT_LOCALE;
}
