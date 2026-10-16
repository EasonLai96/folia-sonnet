import type { VisualizerMode } from '../../types';
// 键表与 bundle 类型在低层（同步 / OBS 配置按字段名读写设置，它们不能依赖组件目录）。
// 这里再导出一次类型，是为了不打断已经从 registry 取它们的 9 个模块。
import { assertVisualizerTuningKeys } from '../../utils/visualizer/tunings';
import type { VisualizerTuningBundle, VisualizerTuningMap, VisualizerTuningMode } from '../../utils/visualizer/tunings';
import type { VisualizerSharedProps } from './definition';

export type { VisualizerTuningBundle, VisualizerTuningMap, VisualizerTuningMode } from '../../utils/visualizer/tunings';

// src/components/visualizer/tuningRegistry.ts
// Pure-data registry for transporting heterogeneous visualizer tuning without importing renderers.
export interface VisualizerTuningAdapter<M extends VisualizerTuningMode = VisualizerTuningMode> {
    mode: M;
    settingsKey: string;
    settingsSetterKey: string;
    apply: (props: VisualizerSharedProps, tuning: VisualizerTuningMap[M]) => VisualizerSharedProps;
}

interface VisualizerTuningModule {
    default: VisualizerTuningAdapter;
}

export function defineVisualizerTuning<M extends VisualizerTuningMode>(adapter: VisualizerTuningAdapter<M>) {
    return adapter;
}

const tuningModules = import.meta.glob<VisualizerTuningModule>('./*/tuning.ts', { eager: true });
const adapters = Object.values(tuningModules).map(module => module.default);
const adaptersByMode = new Map<VisualizerTuningMode, VisualizerTuningAdapter>();

adapters.forEach(adapter => {
    if (adaptersByMode.has(adapter.mode)) {
        throw new Error(`[VisualizerTuningRegistry] Duplicate adapter for "${adapter.mode}"`);
    }
    adaptersByMode.set(adapter.mode, adapter);
});

// 上面这些 settingsKey / settingsSetterKey 与 utils/visualizer/tunings.ts 的键表必须逐字相同：
// 那份表是同步与 OBS 配置读写设置的依据，从这里飘走的话，读和写会指向不同的字段。
assertVisualizerTuningKeys('VisualizerTuningRegistry', adapters);

export const applyVisualizerTuning = (
    mode: VisualizerMode,
    props: VisualizerSharedProps,
    bundle?: VisualizerTuningBundle,
): VisualizerSharedProps => {
    const adapter = adaptersByMode.get(mode as VisualizerTuningMode);
    const tuning = bundle?.[mode as VisualizerTuningMode];
    return adapter && tuning ? adapter.apply(props, tuning as never) : props;
};

export const getVisualizerTuningModes = (): VisualizerTuningMode[] => [...adaptersByMode.keys()];
