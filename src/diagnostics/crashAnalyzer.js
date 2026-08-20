// src/diagnostics/crashAnalyzer.js
const fs = require('fs-extra');
const path = require('path');

const PATTERNS = [
    {
        pattern: /UnsupportedClassVersionError/i,
        cause: 'Java incompatible con la versión requerida.'
    },
    {
        pattern: /Could not create the Java Virtual Machine/i,
        cause: 'Java no pudo iniciar la máquina virtual.'
    },
    {
        pattern: /Unable to access jarfile/i,
        cause: 'Falta un archivo JAR requerido.'
    },
    {
        pattern: /Mixin apply failed|MixinApplyError/i,
        cause: 'Un mod Mixin no pudo aplicarse.'
    },
    {
        pattern: /ModResolutionException|Incompatible mods/i,
        cause: 'Hay mods incompatibles o falta una dependencia.'
    },
    {
        pattern: /NoSuchMethodError|NoClassDefFoundError/i,
        cause: 'Una biblioteca o mod no coincide con la versión instalada.'
    },
    {
        pattern: /fabric loader/i,
        cause: 'Existe un problema relacionado con Fabric Loader.'
    }
];

function readTail(filePath, maxBytes = 256 * 1024) {
    if (!filePath || !fs.existsSync(filePath)) return '';

    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');

    try {
        const buffer = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        return buffer.toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

function analyzeText(text) {
    const source = String(text || '');
    const causes = [];

    for (const rule of PATTERNS) {
        if (rule.pattern.test(source)) {
            causes.push(rule.cause);
        }
    }

    const uniqueCauses = [...new Set(causes)];

    return {
        severity: uniqueCauses.length ? 'error' : 'unknown',
        causes: uniqueCauses,
        likelyCause:
            uniqueCauses[0] ||
            'No se pudo determinar automáticamente la causa.'
    };
}

function findLogCandidates(instancePath) {
    if (!instancePath) return [];

    const roots = [
        path.join(instancePath, '.minecraft'),
        instancePath
    ];

    const found = [];

    for (const root of roots) {
        for (const relative of [
            'logs/latest.log',
            'logs/debug.log',
            'minecraft-runtime.log'
        ]) {
            const candidate = path.join(root, relative);

            if (
                fs.existsSync(candidate) &&
                fs.statSync(candidate).isFile()
            ) {
                found.push(candidate);
            }
        }

        const crashDir = path.join(root, 'crash-reports');

        if (
            fs.existsSync(crashDir) &&
            fs.statSync(crashDir).isDirectory()
        ) {
            for (const file of fs.readdirSync(crashDir)) {
                if (/\.txt$/i.test(file)) {
                    found.push(path.join(crashDir, file));
                }
            }
        }
    }

    return [...new Set(found)];
}

function analyzeInstance(instancePath) {
    const files = findLogCandidates(instancePath);
    let combined = '';

    for (const file of files.slice(-5)) {
        combined += `\n===== ${file} =====\n`;
        combined += readTail(file);
    }

    return {
        success: true,
        analyzedFiles: files,
        ...analyzeText(combined)
    };
}

module.exports = {
    analyzeText,
    analyzeInstance,
    findLogCandidates
};
