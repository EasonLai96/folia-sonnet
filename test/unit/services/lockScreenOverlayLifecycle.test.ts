import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Issue #112：钉住原生宿主的生命周期交接；这是源码契约检查，不代替设备上的窗口行为验证。
const activitySource = readFileSync(new URL(
    '../../../android/app/src/main/java/top/izuna/foliamajor/LockScreenMusicActivity.kt',
    import.meta.url,
), 'utf8');

function lifecycleBody(name: string): string {
    const match = activitySource.match(new RegExp(`override fun ${name}\\(\\) \\{([\\s\\S]*?)\\n    \\}`));
    expect(match, `LockScreenMusicActivity must override ${name}`).not.toBeNull();
    return match![1];
}

describe('Android lock-screen overlay host lifecycle (#112)', () => {
    it('releases the host onStop even when the activity is not finishing or destroyed', () => {
        const body = lifecycleBody('onStop');
        expect(body).toContain('.setLockScreenHost(null)');
        // STOPPED 不等于 finishing：不能把清理藏进 finish / destroy 分支。
        expect(body).not.toMatch(/\b(if|isFinishing|isDestroyed|finish)\b/);
        expect(body.indexOf('.setLockScreenHost(null)')).toBeLessThan(body.indexOf('super.onStop()'));
    });

    it('hands the window token back onResume so the same activity can be reused', () => {
        const body = lifecycleBody('onResume');
        expect(body).toContain('handWindowTokenToOverlay()');
        expect(body.indexOf('super.onResume()')).toBeLessThan(body.indexOf('handWindowTokenToOverlay()'));
        expect(activitySource).toMatch(/private fun handWindowTokenToOverlay\(\)[\s\S]*?decorView\.post\s*\{[\s\S]*?\.setLockScreenHost\(this@LockScreenMusicActivity\)/);
    });

    it('retains the destroy-time cleanup as a fallback', () => {
        expect(lifecycleBody('onDestroy')).toContain('.setLockScreenHost(null)');
    });
});
