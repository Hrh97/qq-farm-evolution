function toBooleanFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function createAdminRouteHelpers({ store, userStore, logger, getProvider }) {
  function requireDangerConfirmation(req, res, requiredConfirmation) {
    const confirmed = req && req.body ? toBooleanFlag(req.body.confirmed) : false;
    if (!confirmed) {
      return (
        res.status(400).json({
          ok: false,
          error: '危险操作未确认',
          requiredConfirmation,
        }),
        false
      );
    }
    return true;
  }

  function getAdminUserMutationError(currentUser, targetUsername) {
    const normalizedTarget = String(targetUsername || '').trim();
    if (!currentUser || !normalizedTarget) return null;
    if (currentUser.role === 'super_admin') return null;
    if (String(currentUser.username || '').trim() === normalizedTarget) return null;
    try {
      const users = userStore.getAllUsers();
      const targetUser = Array.isArray(users)
        ? users.find(
            user => String(user.username || '').trim() === normalizedTarget,
          )
        : null;
      if (targetUser && targetUser.role === 'admin')
        return '普通管理员不能修改或删除其他管理员账号';
    } catch {}
    return null;
  }

  function checkAccountLimit(mode) {
    const antiResaleConfig = store.getAntiResaleConfig();
    if (!antiResaleConfig.accountLimitEnabled) {
      return {
        ok: true,
        enabled: false,
        triggered: false,
        message: '账号数量限制功能未启用',
      };
    }
    const provider = typeof getProvider === 'function' ? getProvider() : null;
    if (!provider || typeof provider.getRunningAccountCount !== 'function') {
      return {
        ok: false,
        enabled: true,
        error: '无法获取运行账号数量',
      };
    }
    const runningCount = provider.getRunningAccountCount();
    const threshold = antiResaleConfig.accountLimitThreshold || 25;
    const triggered = runningCount > threshold;
    const result = {
      ok: true,
      enabled: true,
      triggered,
      runningCount,
      threshold,
      mode: mode || 'dry-run',
    };
    result.message = triggered
      ? `检测到运行账号数量(${  runningCount  })超过阈值(${  threshold  })`
      : `当前运行账号数量(${  runningCount  })未超过阈值(${  threshold  })`;
    return result;
  }

  function checkAccountLimitInterval() {
    try {
      const limitResult = checkAccountLimit('interval');
      if (!limitResult.ok || !limitResult.enabled || !limitResult.triggered)
        return;
      logger.warn('账号数量超限，已拦截自动清空账号动作', {
        runningCount: limitResult.runningCount,
        threshold: limitResult.threshold,
        mode: 'observe_only',
      });
    } catch (err) {
      logger.error('检查账号数量限制失败', {
        error: err.message,
      });
    }
  }

  // Worker 面板就绪闸门的固定本地拒绝（worker.js handleApiCall），逐字精确
  // 匹配才按预期错误放行 HTTP 200 + ok:false（反馈分类未就绪）；相似但不一致
  // 的错误——含面板读取失败冷却提示——仍按原失败语义回 500，不按关键词放宽。
  const PANEL_NOT_READY_ERROR = '账号未就绪（未登录或连接未打开），请稍后重试';

  // 治理器硬预算拒绝的固定文案前缀（reason 为白名单枚举：budget_total/method/friend）。
  // 偷菜突发打满 60s 预算时，面板只读端点（背包/访客记录/狗礼物/神秘商店）也会被拦；
  // 这类"本地零发送"拒绝是预期可重试状态，应按 200 + ok:false 返回，而不是 500。
  // 用固定前缀 + 白名单 reason 精确匹配，不做模糊关键词放宽（与 PANEL_NOT_READY 同口径）。
  const GOVERNED_BUDGET_MESSAGE_RE = /^请求被治理器拦截\(budget_(total|method|friend)\):\s/;

  function isGovernedBudgetRejection(err) {
    if (!err) return false;
    // 结构化标记优先（本地调用、跨进程白名单字段保留时）
    if (err.isGovernedRejection === true
      && (err.governedReason === 'budget_total'
        || err.governedReason === 'budget_method'
        || err.governedReason === 'budget_friend')) return true;
    // 文案兜底：worker 跨进程只保证 message 保留，格式固定
    return GOVERNED_BUDGET_MESSAGE_RE.test(String(err.message || ''));
  }

  function isExpectedProviderError(err) {
    const message = String((err && err.message) || '');
    return message === '账号未运行'
      || message === 'API Timeout'
      || message === PANEL_NOT_READY_ERROR
      || isGovernedBudgetRejection(err);
  }

  function sendProviderError(res, err) {
    if (res.headersSent || res.writableEnded || res.destroyed || res.locals?.requestTimedOut)
      return;

    if (isExpectedProviderError(err)) {
      return res.json({
        ok: false,
        error: err.message,
      });
    }
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }

  function requireAdminRole(req, res, next) {
    if (
      !req.currentUser
      || (req.currentUser.role !== 'admin'
        && req.currentUser.role !== 'super_admin')
    ) {
      return res.status(403).json({
        ok: false,
        error: '需要管理员权限',
      });
    }
    next();
  }

  function requireSuperAdminRole(req, res, next) {
    if (!req.currentUser || req.currentUser.role !== 'super_admin') {
      return res.status(403).json({
        ok: false,
        error: '需要超级管理员权限',
      });
    }
    next();
  }

  return {
    checkAccountLimit,
    checkAccountLimitInterval,
    getAdminUserMutationError,
    requireAdminRole,
    requireDangerConfirmation,
    requireSuperAdminRole,
    sendProviderError,
  };
}

module.exports = {
  createAdminRouteHelpers,
};
