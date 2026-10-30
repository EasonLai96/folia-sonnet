// 旧外观配置的独立反向开关只在导入边界迁移；新配置始终只携带方向值。
export const migrateLibraryWallSeamConfig = <T extends Record<string, unknown>>(config: T): T => {
    if (config.libraryWallSeamDirectionReverse === undefined) return config;
    const migrated: Record<string, unknown> = { ...config };
    const direction = config.libraryWallSeamDirection;
    if (direction !== 'vertical' && direction !== 'horizontal' && direction !== 'auto-reverse') {
        migrated.libraryWallSeamDirection = config.libraryWallSeamDirectionReverse === false ? 'auto' : 'auto-reverse';
    }
    delete migrated.libraryWallSeamDirectionReverse;
    return migrated as T;
};
