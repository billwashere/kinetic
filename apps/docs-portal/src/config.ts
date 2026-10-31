/**
 * Portal configuration — driven by environment variables for subtree deployments.
 *
 * ALL values can be set from OUTSIDE the git subtree via environment variables.
 * Set these in your monorepo's root .env file, never inside the subtree directory.
 *
 * KINETIC_SITE_NAME           — browser title and sidebar logo text
 * KINETIC_SITE_DESCRIPTION    — default meta description
 * KINETIC_FAVICON             — favicon URL (served from public/)
 * KINETIC_COLOR_PRIMARY       — main accent colour hex (e.g. #9333ea)
 * KINETIC_COLOR_PRIMARY_LIGHT — very light tint of primary (e.g. #faf5ff)
 * KINETIC_COLOR_PRIMARY_MID   — mid tint of primary for borders (e.g. #e9d5ff)
 * KINETIC_COLOR_BG            — page background colour
 * KINETIC_COLOR_SURFACE       — card/content background colour
 * KINETIC_COLOR_SIDEBAR       — sidebar background colour
 * KINETIC_LOCALE_LABELS       — JSON string: {"en-US":"EN","ar-AE":"AR"}
 * KINETIC_LOCALE_NAMES        — JSON string: {"en-US":"English","ar-AE":"Arabic"}
 * KINETIC_LOGO                — optional logo image URL (root-relative paths are made page-relative)
 * KINETIC_SUPPORT_URL         — optional support link; the "Need help?" card is hidden when unset
 *
 * For subtree deployments, also set:
 * KINETIC_PUBLIC_DIR          — absolute path to the public/ directory (astro.config.mjs)
 * KINETIC_LOCALES_DIR         — absolute path to locale JSON files (page route)
 * KINETIC_GENERATED_DIR       — absolute path to generated/ directory (page route)
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspace, dirs } from './lib/workspace.mjs';

const ws = workspace as any;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const SITE = {
  name: env('KINETIC_SITE_NAME', ws.site?.name ?? 'Kinetic Docs'),
  description: env(
    'KINETIC_SITE_DESCRIPTION',
    ws.site?.description ?? 'Step-by-step product documentation with video walkthroughs.',
  ),
  favicon: env('KINETIC_FAVICON', ws.site?.favicon ?? '/assets/favicon.ico'),
  logo: env('KINETIC_LOGO', ''),
  supportUrl: env('KINETIC_SUPPORT_URL', ''),
} as const;

export const THEME = {
  primary: env('KINETIC_COLOR_PRIMARY', ws.theme?.primary ?? '#2563eb'),
  primaryLight: env('KINETIC_COLOR_PRIMARY_LIGHT', ws.theme?.primaryLight ?? '#eff6ff'),
  primaryMid: env('KINETIC_COLOR_PRIMARY_MID', ws.theme?.primaryMid ?? '#bfdbfe'),
  bg: env('KINETIC_COLOR_BG', '#f8fafc'),
  surface: env('KINETIC_COLOR_SURFACE', '#ffffff'),
  sidebar: env('KINETIC_COLOR_SIDEBAR', '#ffffff'),
} as const;

export function themeStyleTag(): string {
  return (
    `<style>:root{` +
    `--kinetic-primary:${THEME.primary};` +
    `--kinetic-primary-light:${THEME.primaryLight};` +
    `--kinetic-primary-mid:${THEME.primaryMid};` +
    `--kinetic-bg:${THEME.bg};` +
    `--kinetic-surface:${THEME.surface};` +
    `--kinetic-sidebar:${THEME.sidebar};` +
    `}` +
    // Dark mode derives its tints from the primary colour so a rebrand needs no extra settings.
    `.dark{` +
    `--kinetic-primary-light:color-mix(in srgb,${THEME.primary} 18%,#0f172a);` +
    `--kinetic-primary-mid:color-mix(in srgb,${THEME.primary} 45%,#0f172a);` +
    `}</style>`
  );
}

export const LOCALE_LABELS: Record<string, string> = process.env.KINETIC_LOCALE_LABELS
  ? JSON.parse(process.env.KINETIC_LOCALE_LABELS)
  : {
      'en-US': 'EN',
      'ar-AE': 'AR',
      'fr-FR': 'FR',
      'de-DE': 'DE',
      'es-ES': 'ES',
      'ja-JP': 'JA',
      'zh-CN': 'ZH',
      'pt-BR': 'PT',
      'ko-KR': 'KO',
    };

export const LOCALE_NAMES: Record<string, string> = process.env.KINETIC_LOCALE_NAMES
  ? JSON.parse(process.env.KINETIC_LOCALE_NAMES)
  : {
      'en-US': 'English',
      'ar-AE': 'Arabic',
      'fr-FR': 'French',
      'de-DE': 'German',
      'es-ES': 'Spanish',
      'ja-JP': 'Japanese',
      'zh-CN': 'Chinese',
      'pt-BR': 'Portuguese',
      'ko-KR': 'Korean',
    };

/** Interface chrome text. Page content stays in the engine's locale files; this is only UI labels. */
const UI_EN = {
  guides: 'User guides',
  walkthroughs: 'Walkthroughs',
  filterPages: 'Filter pages',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  walkthroughsBlurb: 'short step-by-step videos',
  walkthroughsIntro: 'Watch a task being done, with each step written out underneath.',
  guidesBlurb: 'written guides by topic',
  guidesIntro: 'Written guides for processes, configuration and everyday tasks.',
  explanationBlurb: 'Search the concepts and how they connect',
  video: 'Video',
  steps: 'Steps',
  howTo: 'Walkthroughs',
  tutorials: 'Tutorials',
  explanation: 'Explanation',
  search: 'Search documentation',
  searchResults: 'Search results',
  noResults: 'No results',
  onThisPage: 'On this page',
  relatedGuides: 'Related guides',
  relatedConcepts: 'Related concepts',
  needHelp: 'Need help?',
  supportText: 'Contact the support team if you need help with this task.',
  getSupport: 'Get support',
  forLabel: 'For',
  time: 'Time',
  prerequisites: 'Prerequisites',
  outcome: 'Outcome',
  overview: 'Overview',
  learnMore: 'Learn more about',
  done: "You're done",
  result: 'Result',
  note: 'Note',
  previous: 'Previous',
  next: 'Next',
  language: 'Language',
  version: 'Version',
  home: 'Home',
  openNav: 'Open navigation',
  closeNav: 'Close navigation',
  darkMode: 'Dark mode',
  primaryNav: 'Documentation sections',
  pagesNav: 'Pages in this section',
  breadcrumb: 'Breadcrumb',
  pageNav: 'Page navigation',
  relatedKnowledge: 'Related knowledge',
  verifiedNote:
    '"Verified" means the build checked the supporting evidence against the test steps or source files it cites.',
  evidence: 'Evidence',
  exploreInGraph: 'Explore in graph',
  exploreGraph: 'Explore the knowledge graph',
  searchConcepts: 'Search concepts',
  relationshipTypes: 'Relationship types',
  relationships: 'Relationships',
  noRelationships: 'No relationships shown.',
  furtherOut: 'Further out',
  nothingFurther: 'Nothing further.',
  expand: 'Expand neighbourhood',
  collapse: 'Collapse neighbourhood',
  backToProcedure: 'Back to this procedure',
  loadingGraph: 'Loading graph…',
  graphUnavailable:
    'The interactive graph is unavailable here. The related knowledge above is still complete.',
  boundedSubset: 'Showing a bounded subset; filter by relationship type to narrow.',
  thisProcedure: 'this procedure',
  verification: {
    verified: 'verified',
    asserted: 'asserted',
    unevidenced: 'unevidenced',
  } as Record<string, string>,
  /** [label, inverse label] per relationship type; empty means "use the registry's English labels". */
  relationLabels: {} as Record<string, [string, string]>,
};
export type UiStrings = typeof UI_EN;

// Arabic chrome strings: written for this portal and pending native-speaker review.
const UI_STRINGS: Record<string, Partial<UiStrings>> = {
  'en-US': UI_EN,
  'ar-AE': {
    howTo: 'أدلة إرشادية',
    tutorials: 'دروس تعليمية',
    explanation: 'شروحات',
    search: 'ابحث في الوثائق',
    searchResults: 'نتائج البحث',
    noResults: 'لا توجد نتائج',
    onThisPage: 'في هذه الصفحة',
    relatedGuides: 'أدلة ذات صلة',
    relatedConcepts: 'مفاهيم ذات صلة',
    needHelp: 'هل تحتاج إلى مساعدة؟',
    supportText: 'تواصل مع فريق الدعم إذا احتجت إلى مساعدة في هذه المهمة.',
    getSupport: 'تواصل مع الدعم',
    forLabel: 'لمن',
    time: 'الوقت',
    prerequisites: 'المتطلبات المسبقة',
    outcome: 'النتيجة',
    overview: 'نظرة عامة',
    learnMore: 'اعرف المزيد عن',
    done: 'انتهيت',
    result: 'النتيجة',
    note: 'ملاحظة',
    steps: 'الخطوات',
    previous: 'السابق',
    next: 'التالي',
    language: 'اللغة',
    version: 'الإصدار',
    home: 'الرئيسية',
    openNav: 'فتح التنقل',
    closeNav: 'إغلاق التنقل',
    darkMode: 'الوضع الداكن',
    primaryNav: 'أقسام الوثائق',
    pagesNav: 'صفحات هذا القسم',
    breadcrumb: 'مسار التنقل',
    pageNav: 'التنقل بين الصفحات',
    relatedKnowledge: 'معارف ذات صلة',
    verifiedNote:
      '"تم التحقق" تعني أن البناء فحص الدليل الداعم مقابل خطوات الاختبار أو ملفات المصدر المذكورة.',
    evidence: 'الدليل',
    exploreInGraph: 'استكشف في المخطط',
    exploreGraph: 'استكشف مخطط المعرفة',
    searchConcepts: 'ابحث في المفاهيم',
    relationshipTypes: 'أنواع العلاقات',
    relationships: 'العلاقات',
    noRelationships: 'لا توجد علاقات معروضة.',
    furtherOut: 'أبعد من ذلك',
    nothingFurther: 'لا شيء أبعد.',
    expand: 'توسيع النطاق',
    collapse: 'تضييق النطاق',
    backToProcedure: 'العودة إلى هذا الإجراء',
    loadingGraph: 'جارٍ تحميل المخطط…',
    graphUnavailable: 'المخطط التفاعلي غير متاح هنا. المعارف ذات الصلة أعلاه مكتملة.',
    boundedSubset: 'يُعرض جزء محدود؛ صفِّ حسب نوع العلاقة لتضييق النتائج.',
    thisProcedure: 'هذا الإجراء',
    verification: {
      verified: 'تم التحقق',
      asserted: 'مؤكَّد دون دليل آلي',
      unevidenced: 'بلا دليل',
    },
    relationLabels: {
      depends_on: ['يعتمد على', 'مطلوب لـ'],
      part_of: ['جزء من', 'يحتوي على'],
      implements: ['ينفّذ', 'يُنفَّذ بواسطة'],
      uses: ['يستخدم', 'يُستخدَم بواسطة'],
      configured_by: ['يُضبط بواسطة', 'يضبط'],
      documented_by: ['موثَّق في', 'يوثّق'],
      related_to: ['مرتبط بـ', 'مرتبط بـ'],
      supersedes: ['يحل محل', 'حلّ محلّه'],
    },
  },
};

export function uiStrings(locale: string): UiStrings {
  return { ...UI_EN, ...(UI_STRINGS[locale] ?? UI_STRINGS[locale.split('-')[0]] ?? {}) };
}

/** Root-relative site paths become page-relative; absolute URLs pass through unchanged. */
/** The favicon link target, or '' when the configured file is not among the public assets (no broken link). */
export function faviconHref(root: string): string {
  const rel = SITE.favicon;
  if (/^https?:/.test(rel)) return rel;
  return fs.existsSync(path.join(dirs.public, rel.replace(/^\/+/, ''))) ? siteUrl(root, rel) : '';
}

export function siteUrl(root: string, url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? root + url.slice(1) : url;
}
