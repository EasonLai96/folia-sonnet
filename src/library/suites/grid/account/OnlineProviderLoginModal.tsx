import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, LogIn, RotateCcw, ServerCog, X } from 'lucide-react';
import { motion } from 'framer-motion';
import QrLoginFailureHelp, { type QrLoginFailureHelpProps } from './QrLoginFailureHelp';

// src/library/suites/grid/account/OnlineProviderLoginModal.tsx
// 登录弹窗。平时是窄的单栏：二维码、状态行、重试 / 重启；登录失败后变成两栏，失败帮助（简单办法、自检、
// 收起的诊断与反馈）放在二维码旁边，窄窗口里再折回上下排列。
// 密码登录的 provider（飞牛这类自建服务）没有二维码，那一栏换成用户名 / 密码表单。

// 可选的登录方式选择（两步式）。provider 不声明就不传，弹窗完全维持原本的单步外观。
// 所有文案都由调用方翻译好再传进来，与 title / statusText 的既有做法一致。
type LoginMethodsProps = {
    title: string;
    hint: string;
    pendingText: string;
    currentText: string;
    options: Array<{ id: string; label: string; iconUrl: string }>;
    selectedId: string | null;
    onSelect: (id: string) => void;
};

// 后端没起来时二维码永远拿不到，重试只会再报一次同样的错。这里直接把二维码换成失败原因
// 和「重启后端」按钮，让用户不必重开整个 App。
type BackendFailureProps = {
    title: string;
    detail: string | null;
    restartLabel: string;
    restartingLabel: string;
    restarting: boolean;
    /** 不传就不显示重启按钮（suite 没声明 account-backend-restart 时），故障原因照样显示。 */
    onRestart?: () => void;
};

/**
 * 密码登录的表单（飞牛这类自建服务）。
 * 表单自己持有输入框的状态：提交失败时用户改过的东西必须还在，而登录快照一变就会重渲染整个弹窗。
 */
type PasswordFormProps = {
    needsServerUrl: boolean;
    serverLabel: string;
    serverPlaceholder: string;
    usernameLabel: string;
    passwordLabel: string;
    submitLabel: string;
    submittingLabel: string;
    /** 上一次填过的服务器地址（登出不清地址，重登时少填一项）。 */
    initialServerUrl?: string;
    /** 提交中：输入框锁住、按钮转圈。 */
    busy: boolean;
    onSubmit: (values: { serverUrl?: string; username: string; password: string }) => void;
};

const PasswordLoginForm = ({
    needsServerUrl,
    serverLabel,
    serverPlaceholder,
    usernameLabel,
    passwordLabel,
    submitLabel,
    submittingLabel,
    initialServerUrl = '',
    busy,
    onSubmit,
}: PasswordFormProps) => {
    const [serverUrl, setServerUrl] = useState(initialServerUrl);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const usernameRef = useRef<HTMLInputElement | null>(null);
    // 弹窗每次打开都是新的一次登录，焦点落在第一个要填的框上。
    useEffect(() => { usernameRef.current?.focus(); }, []);

    const canSubmit = !busy && username.trim().length > 0 && password.length > 0
        && (!needsServerUrl || serverUrl.trim().length > 0);
    const submit = () => {
        if (!canSubmit) return;
        onSubmit({
            ...(needsServerUrl ? { serverUrl: serverUrl.trim() } : {}),
            username: username.trim(),
            password,
        });
    };

    const fieldClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition-colors placeholder:opacity-35 focus:border-white/25 disabled:opacity-50';
    // 输入框不继承卡片外的文字色：白天 / 夜间两套主题差得远，写死一个值在另一套里必然看不清。
    const fieldStyle = { color: 'var(--text-primary)' } as const;
    return (
        <form
            className="flex w-56 flex-col gap-2.5"
            onSubmit={event => { event.preventDefault(); submit(); }}
        >
            {needsServerUrl && (
                <label className="flex flex-col gap-1 text-left">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                        {serverLabel}
                    </span>
                    <input
                        type="text"
                        value={serverUrl}
                        disabled={busy}
                        onChange={event => setServerUrl(event.target.value)}
                        placeholder={serverPlaceholder}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className={fieldClass}
                        style={fieldStyle}
                    />
                </label>
            )}
            <label className="flex flex-col gap-1 text-left">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {usernameLabel}
                </span>
                <input
                    ref={usernameRef}
                    type="text"
                    value={username}
                    disabled={busy}
                    onChange={event => setUsername(event.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className={fieldClass}
                    style={fieldStyle}
                />
            </label>
            <label className="flex flex-col gap-1 text-left">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {passwordLabel}
                </span>
                <input
                    type="password"
                    value={password}
                    disabled={busy}
                    onChange={event => setPassword(event.target.value)}
                    className={fieldClass}
                    style={fieldStyle}
                />
            </label>
            <button
                type="submit"
                disabled={!canSubmit}
                className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold transition-colors hover:bg-white/15 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white/10"
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                {busy ? submittingLabel : submitLabel}
            </button>
        </form>
    );
};

type OnlineProviderLoginModalProps = {
    title: string;
    /** 当前在登录哪个平台：传了就在标题上方摆该平台的应用图标，一眼看出在登谁。 */
    iconUrl?: string;
    note: string;
    qrCodeImg: string;
    statusText: string;
    state: 'idle' | 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error' | 'password';
    retryLabel: string;
    closeLabel: string;
    /** 后端冷却中：重试按钮照常出现但不可点（状态行说明还要等多久），冷却结束后恢复。 */
    retryDisabled?: boolean;
    loginMethods?: LoginMethodsProps;
    backendFailure?: BackendFailureProps;
    /** 密码登录（飞牛这类自建服务）：传了就用表单替掉二维码那一栏。 */
    passwordForm?: PasswordFormProps;
    // 只在扫码登录失败时传入（含后端没拉起来），显示在二维码旁边。
    failureHelp?: QrLoginFailureHelpProps;
    onRetry: () => void;
    onClose: () => void;
};

const OnlineProviderLoginModal = ({
    title,
    iconUrl,
    note,
    qrCodeImg,
    statusText,
    state,
    retryLabel,
    closeLabel,
    retryDisabled = false,
    loginMethods,
    backendFailure,
    passwordForm,
    failureHelp,
    onRetry,
    onClose,
}: OnlineProviderLoginModalProps) => {
    // 步骤一：还没选登录方式，二维码区显示占位框，且不会向后端发出任何请求。
    const awaitingMethod = Boolean(loginMethods) && loginMethods?.selectedId == null;
    // 后端故障优先于其余所有状态：这时候刷新二维码没有意义。
    const canRetry = (state === 'expired' || state === 'error') && !awaitingMethod && !backendFailure;
    const twoColumns = Boolean(failureHelp);
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 12 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                // 失败后加宽成两栏；矮窗口里放不下时在卡片内滚动，而不是被上下裁掉。
                className={`bg-zinc-900/90 border border-white/10 p-8 rounded-3xl w-full max-h-full overflow-y-auto text-center relative shadow-2xl ${twoColumns ? 'max-w-3xl' : 'max-w-sm'}`}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={closeLabel}
                    className="absolute top-4 right-4 opacity-40 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors cursor-pointer"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <X size={16} />
                </button>
                {iconUrl && (
                    <img
                        src={iconUrl}
                        alt=""
                        aria-hidden="true"
                        className="mx-auto mb-3 h-14 w-14 rounded-2xl object-contain shadow-lg"
                    />
                )}
                <h3 className="text-lg font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                {loginMethods && (
                    <div className="mb-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45 mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                            {loginMethods.title}
                        </p>
                        <p className="text-[11px] leading-snug whitespace-pre-line opacity-55 mb-3" style={{ color: 'var(--text-secondary)' }}>
                            {loginMethods.hint}
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            {loginMethods.options.map(option => {
                                const selected = loginMethods.selectedId === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => loginMethods.onSelect(option.id)}
                                        className={`relative flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-semibold transition-colors cursor-pointer ${selected
                                            ? 'border-green-500 bg-green-500/10 text-white'
                                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                                    >
                                        {selected && (
                                            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white">
                                                <Check size={11} strokeWidth={3} />
                                            </span>
                                        )}
                                        <img src={option.iconUrl} alt="" aria-hidden="true" className="w-6 h-6 object-contain" />
                                        <span>{option.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className={twoColumns ? 'flex flex-col items-center gap-6 sm:flex-row sm:items-start' : 'flex flex-col items-center'}>
                    {/* 左栏：密码表单，或二维码（或后端故障原因）、状态行、重启 / 重试。 */}
                    <div className={`flex flex-col items-center ${twoColumns ? 'w-full sm:w-48 sm:shrink-0' : ''}`}>
                        {passwordForm ? (
                            <div className="mb-4">
                                <PasswordLoginForm {...passwordForm} />
                            </div>
                        ) : (
                        <div className="relative inline-block bg-white p-2 rounded-xl mb-4 shadow-inner">
                            {backendFailure ? (
                                <div className="w-40 h-40 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-red-50 px-3 text-center">
                                    <AlertTriangle className="text-red-500 shrink-0" size={22} />
                                    <p className="text-[11px] font-semibold leading-snug text-red-600">{backendFailure.title}</p>
                                    {backendFailure.detail && (
                                        <p className="max-h-14 w-full overflow-y-auto break-words text-[9px] leading-tight text-red-500/80">
                                            {backendFailure.detail}
                                        </p>
                                    )}
                                </div>
                            ) : awaitingMethod ? (
                                <div className="w-40 h-40 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 text-center text-[11px] font-medium leading-snug text-gray-400">
                                    {loginMethods?.pendingText}
                                </div>
                            ) : qrCodeImg ? (
                                <img src={qrCodeImg} alt="QR Code" className="w-40 h-40" />
                            ) : (
                                <div className="w-40 h-40 flex items-center justify-center bg-gray-100 rounded-lg">
                                    <Loader2 className="animate-spin text-gray-400" size={24} />
                                </div>
                            )}
                        </div>
                        )}
                        {loginMethods && !awaitingMethod && (
                            <p className="text-[11px] font-medium opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                {loginMethods.currentText}
                            </p>
                        )}
                        {/* 步骤一不显示状态文案：关窗重开时 hook 里还留着上一轮的状态，照原样显示会是过期信息。 */}
                        <p className={`text-xs font-medium mt-2 ${state === 'confirmed' ? 'text-green-400' : 'opacity-60'}`} style={{ color: state === 'confirmed' ? undefined : 'var(--text-secondary)' }}>
                            {awaitingMethod || backendFailure ? '' : statusText}
                        </p>
                        {backendFailure?.onRestart && (
                            <button
                                type="button"
                                onClick={backendFailure.onRestart}
                                disabled={backendFailure.restarting}
                                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-default"
                            >
                                {backendFailure.restarting
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <ServerCog size={13} />}
                                {backendFailure.restarting ? backendFailure.restartingLabel : backendFailure.restartLabel}
                            </button>
                        )}
                        {/* 密码登录没有「刷新二维码」这回事：失败就在表单上方改，重试按钮会把人带偏。 */}
                        {canRetry && !passwordForm && (
                            <button type="button" onClick={onRetry} disabled={retryDisabled} className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white/10">
                                <RotateCcw size={13} />
                                {retryLabel}
                            </button>
                        )}
                    </div>
                    {/* 右栏：失败帮助。后端没拉起来时同样给：重启解决不了时，报告里有拉起的每一步与错误原文。 */}
                    {failureHelp && (
                        <div className="w-full min-w-0 flex-1">
                            <QrLoginFailureHelp {...failureHelp} />
                        </div>
                    )}
                </div>
                <p className="text-[10px] opacity-30 mt-6" style={{ color: 'var(--text-secondary)' }}>{note}</p>
            </motion.div>
        </motion.div>
    );
};

export default OnlineProviderLoginModal;
