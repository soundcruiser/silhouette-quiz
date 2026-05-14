// js/state.js

export const state = {
    // データ管理
    rootHandle: null,
    setlist: [], // [{folder, displayName, color, mode:'slide'|'static', questions:[]}]
    currentSetIdx: 0,
    currentQIdx: 0,
    editingCategoryIdx: -1,
    objectUrls: [],
    
    // UI進行・アニメーション状態
    showPhase: 'opening', // 'startup' | 'opening' | 'category' | 'quiz' | 'ending'
    loadQuizId: 0,
    quizLoading: false,
    lastAdvanceTime: 0,

    animState: {
        playing: false,
        paused: false,
        lastSpeed: 2,
        timerId: null,
        startTime: 0,
        elapsed: 0,
        countingDown: false
    },

    // UIオーバーレイ状態
    thinkingOverlayVisible: false,

    // ヘルパーメソッド：現在のカテゴリ・問題を取得
    getCurrentCategory() {
        return this.setlist[this.currentSetIdx] || null;
    },
    getCurrentQuestions() {
        return this.getCurrentCategory()?.questions || [];
    },
    getCurrentMode() {
        return this.getCurrentCategory()?.mode || 'slide';
    }
};