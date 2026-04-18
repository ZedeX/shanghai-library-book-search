/**
 * @file library-utils.js
 * @description 图书馆工具函数库 - 提供通用的图书馆相关操作
 * 
 * 本文件提供图书馆偏好设置、馆藏筛选等通用功能，供其他脚本使用。
 * 
 * 【项目地位】
 * - 作为公共工具库，被 search.js 和 record.js 共同使用
 * - 封装了 localStorage 操作和馆藏数据处理逻辑
 * 
 * 【主要功能】
 * 1. 偏好管理：从 localStorage 读取/保存偏好图书馆
 * 2. 馆藏筛选：按图书馆名称过滤馆藏列表
 * 3. 可借计算：计算馆藏中可借阅的数量
 * 4. 名称匹配：模糊匹配图书馆名称
 * 
 * 【使用方式】
 * 通过全局对象 LibraryUtils 访问所有函数：
 * - LibraryUtils.getPreferredLibrary()
 * - LibraryUtils.setPreferredLibrary(name)
 * - LibraryUtils.filterHoldingsByLibrary(holdings, name)
 * - LibraryUtils.calculateAvailableCount(holdings)
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

/**
 * localStorage 存储键名
 * @constant {string}
 */
const LIBRARY_STORAGE_KEY = 'preferredLibrary';

/**
 * 获取偏好图书馆
 * 从 localStorage 读取用户设置的偏好图书馆
 * @function getPreferredLibrary
 * @returns {string} 偏好图书馆名称，未设置返回空字符串
 */
function getPreferredLibrary() {
    return localStorage.getItem(LIBRARY_STORAGE_KEY) || '';
}

/**
 * 设置偏好图书馆
 * 将偏好图书馆保存到 localStorage
 * @function setPreferredLibrary
 * @param {string} library - 图书馆名称，为空则清除设置
 */
function setPreferredLibrary(library) {
    if (library) {
        localStorage.setItem(LIBRARY_STORAGE_KEY, library);
    } else {
        localStorage.removeItem(LIBRARY_STORAGE_KEY);
    }
}

function isLibraryMatch(holdingLib, filterLib) {
    if (!holdingLib || !filterLib) return false;
    const hLib = holdingLib.toLowerCase();
    const fLib = filterLib.toLowerCase();
    return hLib.includes(fLib) || fLib.includes(hLib) ||
           hLib.indexOf(fLib.replace(/[（）()]/g, '')) !== -1;
}

function filterHoldingsByLibrary(holdings, preferredLibrary) {
    if (!preferredLibrary || !holdings || holdings.length === 0) {
        return holdings || [];
    }
    return holdings.filter(h => isLibraryMatch(h.library, preferredLibrary));
}

function findMatchingLibrary(preferredLib, libraries) {
    if (!preferredLib) return '';
    for (const lib of libraries) {
        if (isLibraryMatch(lib, preferredLib)) {
            return lib;
        }
    }
    return preferredLib;
}

function calculateAvailableCount(holdings) {
    if (!holdings || holdings.length === 0) return 0;
    return holdings.filter(h => {
        const status = h.status || '';
        return status.includes('已归还') && !status.includes('流转中');
    }).length;
}

function getHoldingsSummary(holdings, preferredLibrary) {
    const filtered = filterHoldingsByLibrary(holdings, preferredLibrary);
    const availableCount = calculateAvailableCount(filtered);
    const totalCount = filtered.length;
    return {
        filtered: filtered,
        totalCount: totalCount,
        availableCount: availableCount,
        hasPreference: !!preferredLibrary
    };
}

window.LibraryUtils = {
    getPreferredLibrary,
    setPreferredLibrary,
    isLibraryMatch,
    filterHoldingsByLibrary,
    findMatchingLibrary,
    calculateAvailableCount,
    getHoldingsSummary,
    LIBRARY_STORAGE_KEY
};
