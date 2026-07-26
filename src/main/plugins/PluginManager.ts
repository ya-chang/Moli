// src/main/plugins/PluginManager.ts
// 插件管理器 — 安装/卸载/启用/禁用/加载 + 注册表管理

import { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync, copyFileSync } from 'fs'
import { join } from 'path'
import { PluginSandbox, type PluginModule } from './PluginSandbox'
import { createPluginAPI, type PluginAPI } from './PluginAPI'
import { PluginPermissions } from './PluginPermissions'
import { PluginConfig } from './PluginConfig'
import { PluginErrorHandler } from './PluginErrorHandler'
import { PluginHealthCheck } from './PluginHealthCheck'
import { PluginEventBus } from './PluginEventBus'
import { PluginDataShare } from './PluginDataShare'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

// ─── 注册表类型 ───

export interface InstalledPlugin {
  id: string
  file: string
  name: string
  version: string
  scope: 'global' | 'character'
  type: 'normal' | 'sensor'
  enabled: boolean
  installedAt: string
  permissions: string[]
  targetCharacters?: string[]
  priority: number
}

interface Registry {
  plugins: InstalledPlugin[]
}

// ─── 安装结果 ───

export interface InstallResult {
  success: boolean
  meta?: PluginModule['meta']
  error?: string
}

// ─── PluginManager ───

export class PluginManager {
  private plugins: Map<string, PluginModule> = new Map()
  private registries: Map<string, InstalledPlugin> = new Map()
  private sandbox = new PluginSandbox()
  private api!: PluginAPI
  private permissions = new PluginPermissions()
  private config!: PluginConfig
  private errorHandler!: PluginErrorHandler
  private healthCheck!: PluginHealthCheck
  private eventBus!: PluginEventBus
  private dataShare!: PluginDataShare
  private pluginDir: string
  private registryPath: string
  private dataDir: string

  constructor(mainWindow: BrowserWindow, dataDir?: string) {
    this.dataDir = dataDir || PATHS.base
    this.pluginDir = join(this.dataDir, 'plugins')
    this.registryPath = join(this.pluginDir, 'installed.json')

    this.eventBus = new PluginEventBus()
    this.dataShare = new PluginDataShare(this.dataDir)
    this.api = createPluginAPI(mainWindow, this.dataDir, () => this, this.eventBus, this.dataShare)
    this.config = new PluginConfig(this.dataDir)
    this.errorHandler = new PluginErrorHandler({
      onAutoDisable: (pluginId: string) => {
        this.disable(pluginId)
        const entry = this.registries.get(pluginId)
        if (entry) entry.enabled = false
        this.saveRegistry()
        logger.warn(`[插件] ${pluginId} 因错误过多已自动禁用`)
      }
    })
    this.healthCheck = new PluginHealthCheck()

    this.ensureDirs()
    this.loadRegistry()
    this.loadPermissionSwitches()
  }

  // ═══════════════════════════════════════════
  // 安装
  // ═══════════════════════════════════════════

  async install(filePath: string): Promise<InstallResult> {
    // 1. 读取并解析插件
    let code: string
    try {
      code = readFileSync(filePath, 'utf-8')
    } catch {
      return { success: false, error: '无法读取插件文件' }
    }

    let plugin: PluginModule
    try {
      plugin = this.sandbox.load(code, filePath)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '插件格式错误' }
    }

    const meta = plugin.meta
    if (!meta?.id || !meta?.name) {
      return { success: false, error: '插件缺少 meta.id 或 meta.name' }
    }

    // 2. 检查是否已安装
    if (this.isInstalled(meta.id)) {
      return { success: false, error: `插件 "${meta.name}" 已安装` }
    }

    // 3. 感知插件互斥检查
    if (meta.type === 'sensor') {
      const existingSensor = this.getInstalled().find(p => p.type === 'sensor' && p.enabled)
      if (existingSensor) {
        return {
          success: false,
          error: `已安装感知插件 "${existingSensor.name}"，感知插件只能同时运行1个`
        }
      }
    }

    // 4. 复制文件到插件目录
    const destPath = join(this.pluginDir, `${meta.id}.js`)
    copyFileSync(filePath, destPath)

    // 5. 注册
    const entry: InstalledPlugin = {
      id: meta.id,
      file: `${meta.id}.js`,
      name: meta.name,
      version: meta.version || '0.0.0',
      scope: meta.scope || 'global',
      type: meta.type || 'normal',
      enabled: false,
      installedAt: new Date().toISOString(),
      permissions: meta.permissions || [],
      priority: meta.priority ?? 100,
      targetCharacters: []
    }

    this.registries.set(meta.id, entry)
    this.saveRegistry()

    // 6. 初始化权限开关（默认全部允许）
    this.permissions.initOnInstall(meta.id, meta.permissions || [])
    this.savePermissionSwitches()

    // 7. 调用 install 钩子
    try {
      this.plugins.set(meta.id, plugin)
      plugin.install?.(this.api)
      this.errorHandler.recordSuccess(meta.id)
    } catch (err) {
      this.errorHandler.recordError(meta.id, 'install', err)
    }

    logger.info(`插件安装成功: ${meta.name} v${meta.version}`)
    return { success: true, meta }
  }

  // ═══════════════════════════════════════════
  // 卸载
  // ═══════════════════════════════════════════

  uninstall(pluginId: string): void {
    const entry = this.registries.get(pluginId)
    if (!entry) return

    // 1. 如果已启用，先禁用
    if (entry.enabled) {
      this.disable(pluginId)
    }

    // 2. 调用 uninstall 钩子
    const plugin = this.plugins.get(pluginId)
    try {
      plugin?.uninstall?.(this.api)
    } catch (err) {
      this.errorHandler.recordError(pluginId, 'uninstall', err)
    }

    // 3. 清理健康检查、事件监听、共享数据
    this.healthCheck.unregister(pluginId)
    this.errorHandler.clearErrors(pluginId)
    this.eventBus.offAll(pluginId)
    this.dataShare.clearPlugin(pluginId)

    // 3. 删除插件文件
    const filePath = join(this.pluginDir, entry.file)
    if (existsSync(filePath)) unlinkSync(filePath)

    // 4. 删除插件数据
    const dataPath = join(this.pluginDir, 'plugin-data', pluginId)
    if (existsSync(dataPath)) {
      rmSync(dataPath, { recursive: true, force: true })
    }

    // 5. 清理权限开关
    this.permissions.cleanup(pluginId)
    this.savePermissionSwitches()

    // 6. 从注册表移除
    this.registries.delete(pluginId)
    this.plugins.delete(pluginId)
    this.saveRegistry()

    logger.info(`插件已卸载: ${pluginId}`)
  }

  // ═══════════════════════════════════════════
  // 启用
  // ═══════════════════════════════════════════

  async enable(pluginId: string, targetCharacterId?: string): Promise<void> {
    const entry = this.registries.get(pluginId)
    if (!entry) return

    let plugin = this.plugins.get(pluginId)
    if (!plugin) {
      // 从文件加载
      const filePath = join(this.pluginDir, entry.file)
      if (!existsSync(filePath)) {
        logger.error(`插件文件不存在: ${filePath}`)
        throw new Error(`插件文件不存在: ${entry.file}`)
      }
      try {
        const code = readFileSync(filePath, 'utf-8')
        plugin = this.sandbox.load(code, filePath)
        this.plugins.set(pluginId, plugin)
      } catch (err) {
        logger.error(`插件代码加载失败: ${pluginId}`, err)
        throw new Error(`插件代码加载失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // character 插件设置目标角色
    if (entry.scope === 'character' && targetCharacterId) {
      entry.targetCharacters = [targetCharacterId]
      this.saveRegistry()
    }

    // 设置当前插件 ID（供 PluginAPI 识别）
    this.api.setCurrentPlugin(pluginId)

    try {
      await plugin.enable?.(this.api)
      this.errorHandler.recordSuccess(pluginId)
    } catch (err) {
      this.errorHandler.recordError(pluginId, 'enable', err)
      throw new Error(`插件启用失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    entry.enabled = true
    this.saveRegistry()
    logger.info(`插件已启用: ${pluginId}`)
  }

  // ═══════════════════════════════════════════
  // 禁用
  // ═══════════════════════════════════════════

  disable(pluginId: string): void {
    const entry = this.registries.get(pluginId)
    if (!entry) return

    const plugin = this.plugins.get(pluginId)
    if (plugin) {
      this.api.setCurrentPlugin(pluginId)
      try {
        plugin.disable?.(this.api)
      } catch (err) {
        this.errorHandler.recordError(pluginId, 'disable', err)
      }
    }

    entry.enabled = false
    this.saveRegistry()
    logger.info(`插件已禁用: ${pluginId}`)
  }

  // ═══════════════════════════════════════════
  // 切换目标角色（character 插件）
  // ═══════════════════════════════════════════

  switchTarget(pluginId: string, characterId: string): void {
    const entry = this.registries.get(pluginId)
    if (!entry || entry.scope !== 'character') return

    this.disable(pluginId)
    entry.targetCharacters = [characterId]
    this.saveRegistry()
    this.enable(pluginId, characterId)
  }

  // ═══════════════════════════════════════════
  // 重新加载（配置变更时）
  // ═══════════════════════════════════════════

  reload(pluginId: string): void {
    const entry = this.registries.get(pluginId)
    if (!entry) return

    const wasEnabled = entry.enabled
    if (wasEnabled) this.disable(pluginId)

    // 重新从文件加载
    const filePath = join(this.pluginDir, entry.file)
    if (existsSync(filePath)) {
      const code = readFileSync(filePath, 'utf-8')
      const plugin = this.sandbox.load(code, filePath)
      this.plugins.set(pluginId, plugin)
    }

    if (wasEnabled) this.enable(pluginId)
  }

  // ═══════════════════════════════════════════
  // 启动时加载所有已启用插件
  // ═══════════════════════════════════════════

  loadAll(): void {
    const entries = Array.from(this.registries.values())

    // 按 priority 排序
    entries.sort((a, b) => a.priority - b.priority)

    for (const entry of entries) {
      if (!entry.enabled) continue
      try {
        const filePath = join(this.pluginDir, entry.file)
        if (!existsSync(filePath)) {
          logger.warn(`插件文件缺失，跳过: ${entry.id}`)
          continue
        }
        const code = readFileSync(filePath, 'utf-8')
        const plugin = this.sandbox.load(code, filePath)
        this.plugins.set(entry.id, plugin)

        this.api.setCurrentPlugin(entry.id)
        plugin.enable?.(this.api)
        this.errorHandler.recordSuccess(entry.id)

        logger.info(`插件加载成功: ${entry.name} v${entry.version}`)
      } catch (err) {
        this.errorHandler.recordError(entry.id, 'enable', err)
      }
    }

    // 启动健康检查
    this.healthCheck.start()
  }

  // ═══════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════

  getInstalled(): InstalledPlugin[] {
    return Array.from(this.registries.values())
  }

  getPlugin(pluginId: string): PluginModule | undefined {
    return this.plugins.get(pluginId)
  }

  getRegistryEntry(pluginId: string): InstalledPlugin | undefined {
    return this.registries.get(pluginId)
  }

  getPluginInfo(pluginId: string): { meta: PluginModule['meta']; registry: InstalledPlugin } | null {
    const registry = this.registries.get(pluginId)
    if (!registry) {
      logger.warn(`[插件] getPluginInfo: registries 中找不到 ${pluginId}, 已有: ${Array.from(this.registries.keys()).join(',')}`)
      return null
    }

    let plugin = this.plugins.get(pluginId)
    // 如果插件模块未加载，从文件自动加载
    if (!plugin) {
      const filePath = join(this.pluginDir, registry.file)
      if (existsSync(filePath)) {
        try {
          const code = readFileSync(filePath, 'utf-8')
          plugin = this.sandbox.load(code, filePath)
          this.plugins.set(pluginId, plugin)
        } catch (err) {
          logger.error(`[插件] 自动加载 ${pluginId} 失败`, err)
          // 加载失败时用注册表信息构造基本 meta，保证 UI 始终能拿到信息
          return {
            meta: {
              id: registry.id,
              name: registry.name,
              version: registry.version,
              type: registry.type,
              scope: registry.scope,
              priority: registry.priority,
              permissions: registry.permissions
            },
            registry
          }
        }
      }
    }

    if (!plugin) {
      // 文件不存在或加载失败，用注册表信息兜底
      return {
        meta: {
          id: registry.id,
          name: registry.name,
          version: registry.version,
          type: registry.type,
          scope: registry.scope,
          priority: registry.priority,
          permissions: registry.permissions
        },
        registry
      }
    }
    return { meta: plugin.meta, registry }
  }

  isInstalled(pluginId: string): boolean {
    return this.registries.has(pluginId)
  }

  isEnabled(pluginId: string): boolean {
    return this.registries.get(pluginId)?.enabled ?? false
  }

  /**
   * 检查插件是否对指定角色生效
   * global 插件：启用即对所有角色生效
   * character 插件：需要 targetCharacters 包含该角色
   */
  isActiveForCharacter(pluginId: string, characterId: string): boolean {
    const entry = this.registries.get(pluginId)
    if (!entry || !entry.enabled) return false

    if (entry.scope === 'global') return true

    // character 插件：检查目标角色列表
    return entry.targetCharacters?.includes(characterId) ?? false
  }

  /**
   * 获取对指定角色生效的所有已启用插件（按 priority 排序）
   */
  getActivePluginsForCharacter(characterId: string): InstalledPlugin[] {
    return Array.from(this.registries.values())
      .filter(p => this.isActiveForCharacter(p.id, characterId))
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * 获取插件的作用范围信息
   */
  getScopeInfo(pluginId: string): { scope: string; targetCharacters: string[] } | null {
    const entry = this.registries.get(pluginId)
    if (!entry) return null
    return {
      scope: entry.scope,
      targetCharacters: entry.targetCharacters || []
    }
  }

  getPluginDir(): string {
    return this.pluginDir
  }

  getConfig(): PluginConfig {
    return this.config
  }

  getErrorHandler(): PluginErrorHandler {
    return this.errorHandler
  }

  getHealthCheck(): PluginHealthCheck {
    return this.healthCheck
  }

  getEventBus(): PluginEventBus {
    return this.eventBus
  }

  getDataShare(): PluginDataShare {
    return this.dataShare
  }

  setCurrentPlugin(id: string): void {
    this.api.setCurrentPlugin(id)
  }

  // ═══════════════════════════════════════════
  // 权限管理
  // ═══════════════════════════════════════════

  getPluginPermissions(pluginId: string): Array<{ permission: string; granted: boolean; info: { label: string; risk: string; description: string } }> {
    const entry = this.registries.get(pluginId)
    if (!entry) return []
    return this.permissions.getPluginRequiredPermissions(pluginId, entry.permissions)
  }

  setPluginPermission(pluginId: string, permission: string, granted: boolean): void {
    this.permissions.setPermission(pluginId, permission, granted)
    this.savePermissionSwitches()
  }

  checkPluginPermission(pluginId: string, permission: string): boolean {
    return this.permissions.hasPermission(pluginId, permission)
  }

  // ═══════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════

  private ensureDirs(): void {
    if (!existsSync(this.pluginDir)) {
      mkdirSync(this.pluginDir, { recursive: true })
    }
    const dataDir = join(this.pluginDir, 'plugin-data')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
  }

  private loadRegistry(): void {
    if (!existsSync(this.registryPath)) {
      this.saveRegistry()
      return
    }
    try {
      const content = readFileSync(this.registryPath, 'utf-8')
      const registry: Registry = JSON.parse(content)
      for (const entry of registry.plugins || []) {
        this.registries.set(entry.id, entry)
      }
    } catch {
      logger.warn('插件注册表读取失败，使用空注册表')
    }
  }

  private saveRegistry(): void {
    const registry: Registry = {
      plugins: Array.from(this.registries.values())
    }
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8')
  }

  private getPermissionFilePath(): string {
    return join(this.pluginDir, 'permissions.json')
  }

  private loadPermissionSwitches(): void {
    const filePath = this.getPermissionFilePath()
    if (!existsSync(filePath)) return
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, Record<string, boolean>>
      for (const [pluginId, perms] of Object.entries(data)) {
        for (const [perm, granted] of Object.entries(perms)) {
          this.permissions.setPermission(pluginId, perm, granted)
        }
      }
    } catch {
      // ignore
    }
  }

  private savePermissionSwitches(): void {
    const data: Record<string, Record<string, boolean>> = {}
    for (const entry of this.registries.values()) {
      const perms = this.permissions.getPluginRequiredPermissions(entry.id, entry.permissions)
      data[entry.id] = {}
      for (const p of perms) {
        data[entry.id][p.permission] = p.granted
      }
    }
    writeFileSync(this.getPermissionFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  }
}
