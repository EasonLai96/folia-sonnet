import { useCallback, useEffect, useState } from 'react';
import { USER_GUIDE_AUTO_OPEN_VERSION } from '../components/modal/userGuideContent';
import { hasOnboardingLibrarySuiteChoice } from '../library/app/librarySuiteChoice';
import { requestPlaybackEntryViewPrompt, usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';

// src/hooks/useStartupExperienceGate.ts

const LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY = 'folia_last_seen_guide_version';
const FREE_SOFTWARE_NOTICE_SEEN_STORAGE_KEY = 'folia_free_software_notice_seen';

export type StartupExperienceStep = 'free-software-notice' | 'release-notes' | 'playback-entry-view' | 'ponder' | null;

type StartupExperienceState = {
    /** 免费软件声明还没看过。按安装计，不看版本。 */
    needsFreeSoftwareNotice: boolean;
    isFreeSoftwareNoticeOpen: boolean;
    isCurrentRelease: boolean;
    /** Ponder onboarding was completed in some version (it is shown once per install). */
    hasSeenPonder: boolean;
    /**
     * Ponder onboarding was completed in this version. It is the last startup step and nothing else opens it,
     * so this means the whole sequence already ran for this release.
     */
    hasFinishedThisRelease: boolean;
    hasSeenReleaseNotes: boolean;
    isReleaseNotesOpen: boolean;
    hasChosenPlaybackEntryView: boolean;
    /**
     * The library-interface page is still owed (both suites exist and it has never been shown). Unlike everything
     * else here it is not gated by the release: everyone is asked once (2026-10-10), whatever version they are on.
     */
    needsLibrarySuitePrompt: boolean;
    isPlaybackEntryViewPromptOpen: boolean;
    isPonderOnboardingOpen: boolean;
};

/** Chooses the next blocking surface while ensuring that two startup dialogs never overlap. */
export const resolveStartupExperienceStep = ({
    needsFreeSoftwareNotice,
    isFreeSoftwareNoticeOpen,
    isCurrentRelease,
    hasSeenPonder,
    hasFinishedThisRelease,
    hasSeenReleaseNotes,
    isReleaseNotesOpen,
    hasChosenPlaybackEntryView,
    needsLibrarySuitePrompt,
    isPlaybackEntryViewPromptOpen,
    isPonderOnboardingOpen,
}: StartupExperienceState): StartupExperienceStep => {
    if (isFreeSoftwareNoticeOpen || isReleaseNotesOpen || isPlaybackEntryViewPromptOpen || isPonderOnboardingOpen) {
        return null;
    }
    // 声明排在最前面，而且不受版本门控：它回答的是「这是什么」，不是「这次更新了什么」，
    // 每个安装只看一次。放在这里而不是外面单独渲染，是为了让它和其它启动弹窗共用同一个
    // 「同时只开一个」的约束。
    if (needsFreeSoftwareNotice) {
        return 'free-software-notice';
    }
    // The release sequence (notes, the playback choice, the Ponder gate) only runs on the release that auto-opens
    // it, and not again once finished. Release notes are per version; the playback choice and the Ponder gate are
    // once per install, so having finished Ponder must not suppress a later release's notes.
    const releaseDue = isCurrentRelease && !hasFinishedThisRelease;
    if (releaseDue && !hasSeenReleaseNotes) {
        return 'release-notes';
    }
    // The library-interface page is owed once to every install, outside the release gate.
    if ((releaseDue && !hasChosenPlaybackEntryView) || needsLibrarySuitePrompt) {
        return 'playback-entry-view';
    }
    return releaseDue && !hasSeenPonder ? 'ponder' : null;
};

const readLastSeenReleaseNotesVersion = (): string | null => (
    typeof window === 'undefined'
        ? null
        : localStorage.getItem(LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY)
);

const readHasSeenFreeSoftwareNotice = (): boolean => (
    typeof window !== 'undefined' && localStorage.getItem(FREE_SOFTWARE_NOTICE_SEEN_STORAGE_KEY) === '1'
);

/**
 * Runs the first-launch sequence: release notes, the two-page choice prompt (library interface, then
 * playback destination), then the Ponder shortcut gate. The prompt is gated by the playback choice alone,
 * so installs that answered the older single-page prompt are not asked again.
 */
export const useStartupExperienceGate = () => {
    const lastSeenPonderVersion = useSettingsModalStore(state => state.lastSeenGuideVersion);
    const isPonderOnboardingOpen = useSettingsModalStore(state => state.isUserGuideModalOpen);
    const setIsPonderOnboardingOpen = useSettingsModalStore(state => state.setIsUserGuideModalOpen);
    const hasChosenPlaybackEntryView = usePlaybackEntryViewStore(state => state.hasChosenPlaybackEntryView);
    const hasSeenLibrarySuitePrompt = usePlaybackEntryViewStore(state => state.hasSeenLibrarySuitePrompt);
    const needsLibrarySuitePrompt = hasOnboardingLibrarySuiteChoice() && !hasSeenLibrarySuitePrompt;
    const isPlaybackEntryViewPromptOpen = usePlaybackEntryViewStore(state => state.isPlaybackEntryViewPromptOpen);
    const [lastSeenReleaseNotesVersion, setLastSeenReleaseNotesVersion] = useState(readLastSeenReleaseNotesVersion);
    const [hasSeenFreeSoftwareNotice, setHasSeenFreeSoftwareNotice] = useState(readHasSeenFreeSoftwareNotice);
    const [isFreeSoftwareNoticeOpen, setIsFreeSoftwareNoticeOpen] = useState(false);
    const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
    const appVersion = typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__;

    const nextStep = resolveStartupExperienceStep({
        needsFreeSoftwareNotice: !hasSeenFreeSoftwareNotice,
        isFreeSoftwareNoticeOpen,
        isCurrentRelease: Boolean(appVersion && USER_GUIDE_AUTO_OPEN_VERSION === appVersion),
        hasSeenPonder: lastSeenPonderVersion !== null,
        hasFinishedThisRelease: Boolean(appVersion && lastSeenPonderVersion === appVersion),
        hasSeenReleaseNotes: Boolean(appVersion && lastSeenReleaseNotesVersion === appVersion),
        isReleaseNotesOpen,
        hasChosenPlaybackEntryView,
        needsLibrarySuitePrompt,
        isPlaybackEntryViewPromptOpen,
        isPonderOnboardingOpen,
    });

    useEffect(() => {
        if (nextStep === 'free-software-notice') {
            setIsFreeSoftwareNoticeOpen(true);
        } else if (nextStep === 'release-notes') {
            setIsReleaseNotesOpen(true);
        } else if (nextStep === 'playback-entry-view') {
            requestPlaybackEntryViewPrompt({ withLibrarySuite: hasOnboardingLibrarySuiteChoice() });
        } else if (nextStep === 'ponder') {
            setIsPonderOnboardingOpen(true);
        }
    }, [nextStep, setIsPonderOnboardingOpen]);

    const closeReleaseNotes = useCallback(() => {
        if (appVersion) {
            localStorage.setItem(LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY, appVersion);
            setLastSeenReleaseNotesVersion(appVersion);
        }
        setIsReleaseNotesOpen(false);
    }, [appVersion]);

    // 关掉就记下看过。它不是「同意才能用」，所以关闭路径（右上角 X、点遮罩）也走这里 ——
    // 不记的话每次冷启动都会再弹一次。
    const closeFreeSoftwareNotice = useCallback(() => {
        try {
            localStorage.setItem(FREE_SOFTWARE_NOTICE_SEEN_STORAGE_KEY, '1');
        } catch (error) {
            console.warn('[startup] Failed to persist the free-software notice flag:', error);
        }
        setHasSeenFreeSoftwareNotice(true);
        setIsFreeSoftwareNoticeOpen(false);
    }, []);

    return {
        isFreeSoftwareNoticeOpen,
        closeFreeSoftwareNotice,
        isReleaseNotesOpen,
        closeReleaseNotes,
    };
};
