// js/constants.js

export const CATEGORY_COLORS = ['#ff2d8a', '#00e5ff', '#ffe42d', '#8aff2d', '#ff8a2d', '#a78bfa'];

export const DB_NAME = 'silhouette-quiz';
export const DB_STORE = 'handles';

export const BUNDLED_CONFIG_FILENAME = 'silhouette-quiz-config.json';
export const SOUND_PACK_DIR = '_sounds';
export const SOUND_CONFIG_SLOTS = [
    'bgm', 'start1', 'start2', 'start3', 'reveal', 
    'countdown', 'opening', 'category', 'qIntro', 'qAfter', 'ending', 'thinkingLoop'
];

export const THINKING_BGM_DUCK_MULT = 0.2;
export const THINKING_BGM_DUCK_OUT_MS = 380;
export const THINKING_BGM_DUCK_IN_MS = 520;

export const FLOATING_SHAPE_EVENTS = ['opening', 'category', 'ending', 'thinking'];
export const DEFAULT_FLOATING_SHAPES_ROW = ['?', '!', '★', '?', '●', '▲', '＋', '◆'];

export const OPENING_LOOP_REFILL_HORIZON_SEC = 14;
export const OPENING_LOOP_REFILL_MS = 320;

export const PLAY_CHROME_TOP_PX = 72;
export const PLAY_CHROME_BOTTOM_PX = 110;
export const PLAY_CURSOR_HIDE_AFTER_MS = 2200;