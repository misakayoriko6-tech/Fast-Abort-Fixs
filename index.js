import {
    eventSource,
    event_types,
    saveSettingsDebounced
} from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

const MODULE_NAME = 'fast_abort_fix';

// 默认配置
const defaultSettings = {
    enabled: true,
    hookStop: true,
    cleanEmpty: true,
    timeoutSeconds: 12
};

// 加载/合并配置
function getSettings() {
    extension_settings[MODULE_NAME] = Object.assign({}, defaultSettings, extension_settings[MODULE_NAME]);
    return extension_settings[MODULE_NAME];
}

let stallTimer = null;

// 强制解锁 UI 状态与释放输入框
export function forceRecoverUI() {
    const settings = getSettings();
    if (!settings.enabled) return;

    console.warn('[FastAbort] 正在强制恢复酒馆输入状态...');

    // 1. 恢复发送与停止按钮
    const sendButton = document.getElementById('send_button');
    const stopButton = document.getElementById('stop_button');
    const sendForm = document.getElementById('send_form');
    const sendTextarea = document.getElementById('send_textarea');

    if (sendButton) {
        sendButton.style.display = 'flex';
        sendButton.removeAttribute('disabled');
    }
    if (stopButton) {
        stopButton.style.display = 'none';
    }
    if (sendForm) {
        sendForm.classList.remove('generating');
    }
    if (sendTextarea) {
        sendTextarea.removeAttribute('disabled');
        sendTextarea.focus();
    }

    // 2. 兜底清除由于卡死留下的空气泡
    if (settings.cleanEmpty) {
        document.querySelectorAll('.mes_text:empty').forEach(el => {
            const mesNode = el.closest('.mes');
            if (mesNode && mesNode.getAttribute('is_system') !== 'true') {
                el.innerHTML = '<em>[生成已手动中断]</em>';
            }
        });
    }

    hideResetButton();
}

// 显示右下角浮动求救按钮
function showResetButton() {
    const settings = getSettings();
    if (!settings.enabled) return;

    let btn = document.getElementById('st-force-reset-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'st-force-reset-btn';
        btn.innerText = '⚡ 强制解锁输入框';
        btn.title = '如果酒馆因中断卡死或按钮消失，点击立刻恢复';
        btn.onclick = () => forceRecoverUI();
        document.body.appendChild(btn);
    }
    btn.style.display = 'block';
}

function hideResetButton() {
    const btn = document.getElementById('st-force-reset-btn');
    if (btn) btn.style.display = 'none';
    if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
    }
}

// 增强原生 Stop 按钮点击响应
function hookStopButton() {
    const stopBtn = document.getElementById('stop_button');
    if (!stopBtn) return;

    stopBtn.addEventListener('click', () => {
        const settings = getSettings();
        if (settings.enabled && settings.hookStop) {
            setTimeout(() => {
                forceRecoverUI();
            }, 200);
        }
    }, true);
}

// 监控生成卡死
function monitorStall() {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
        console.warn('[FastAbort] 检测到生成超时无响应');
        showResetButton();
    }, (settings.timeoutSeconds || 12) * 1000);
}

// 渲染设置面板到扩展页面
async function loadSettingsUI() {
    const settings = getSettings();
    const template = await renderExtensionTemplateAsync('third-party/fast-abort-fix', 'default');
    
    // 挂载到酒馆的扩展设置容器
    const container = $('#extensions_settings');
    if (container.length) {
        container.append(template);
    }

    // 绑定 DOM 元素状态
    const $enabled = $('#fast_abort_enabled');
    const $hookStop = $('#fast_abort_hook_stop');
    const $cleanEmpty = $('#fast_abort_clean_empty');
    const $timeout = $('#fast_abort_timeout');
    const $timeoutVal = $('#fast_abort_timeout_val');
    const $manualUnlock = $('#fast_abort_manual_unlock');

    $enabled.prop('checked', settings.enabled).on('change', function () {
        settings.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $hookStop.prop('checked', settings.hookStop).on('change', function () {
        settings.hookStop = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $cleanEmpty.prop('checked', settings.cleanEmpty).on('change', function () {
        settings.cleanEmpty = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $timeout.val(settings.timeoutSeconds).on('input', function () {
        const val = $(this).val();
        $timeoutVal.text(val);
        settings.timeoutSeconds = Number(val);
        saveSettingsDebounced();
    });
    $timeoutVal.text(settings.timeoutSeconds);

    $manualUnlock.on('click', () => {
        forceRecoverUI();
        toastr?.success?.('已手动重置输入框状态！');
    });
}

// 初始化
jQuery(async () => {
    hookStopButton();
    await loadSettingsUI();

    if (eventSource && event_types) {
        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                monitorStall();
            });
        }

        if (event_types.STREAM_TOKEN_RECEIVED) {
            eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => {
                if (stallTimer) clearTimeout(stallTimer);
            });
        }

        const handleStop = () => {
            hideResetButton();
            setTimeout(forceRecoverUI, 100);
        };

        if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, handleStop);
        if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, handleStop);
    }

    console.log('[FastAbort] 面板及自愈功能加载完成');
});