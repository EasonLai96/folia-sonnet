// Fixed lyric, theme and time inputs shared by the real-runtime mobile probe.
export const NEBBIA_PROBE_SEED = 'nebbia-mobile-614788bf-20261107';
export const NEBBIA_PROBE_TIME = 10;
export const NEBBIA_PROBE_CASES = {
    complex: ['霧箋', '讓', '繁體', '歌詞', '在', '狹窄', '螢幕', '依然', '清晰', '可讀'],
    long: ['讓', '擁擠', '的', '筆畫', '穿過', '朦朧', '霧氣', '與', '斑駁', '燈影', '仍然', '能夠', '清楚', '辨識', '每個', '繁體', '中文字'],
    single: ['鬱鬱蔥蔥霧籠曉夢讓擁擠筆畫清晰可讀鬱鬱蔥蔥霧籠曉夢讓擁擠筆畫清晰可讀'],
};
export const NEBBIA_PROBE_THEME = {
    name: 'Nebbia mobile probe',
    backgroundColor: '#182332', primaryColor: '#f5ded1', accentColor: '#f5bb79', secondaryColor: '#80c9d4',
    fontStyle: 'sans' as const, fontFamily: 'Microsoft JhengHei', fontWeight: 600,
    animationIntensity: 'normal' as const,
};
export const NEBBIA_STROKE_COMMIT = '322be4ff95dafea9f8127793079431f9e39ebf6a';
