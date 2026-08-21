// src/minecraft/libraryManager.js
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { resolveInside } = require('../core/security');
const pLimit = require('p-limit');
const downloadConcurrency = pLimit(24);

function normalizeRelativePath(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const normalized = value
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

    if (
        normalized.includes('\0') ||
        normalized.split('/').some(part => part === '..') ||
        path.posix.isAbsolute(normalized)
    ) {
        return null;
    }

    return normalized;
}

function mavenCoordinateToPath(name, classifier = null, extension = 'jar') {
    if (!name || typeof name !== 'string') return null;

    const parts = name.split(':');
    if (parts.length < 3) return null;

    const group = parts[0];
    const artifact = parts[1];
    const version = parts[2];

    if (!group || !artifact || !version) return null;

    let resolvedClassifier = classifier;

    if (!resolvedClassifier && parts.length === 4) {
        resolvedClassifier = parts[3];
    }

    if (!resolvedClassifier && parts.length >= 5) {
        resolvedClassifier = parts[4];
    }

    const fileName =
        `${artifact}-${version}` +
        (resolvedClassifier ? `-${resolvedClassifier}` : '') +
        `.${extension}`;

    return path.posix.join(
        ...group.split('.'),
        artifact,
        version,
        fileName
    );
}

function repositoryForLibrary(name, fallback) {
    const group = String(name || '').split(':')[0] || '';

    if (
        group === 'net.fabricmc' ||
        group.startsWith('net.fabricmc.')
    ) {
        return 'https://maven.fabricmc.net/';
    }

    if (
        group === 'org.ow2.asm' ||
        group.startsWith('org.ow2.asm.') ||
        group === 'org.spongepowered' ||
        group.startsWith('org.spongepowered.')
    ) {
        return 'https://repo1.maven.org/maven2/';
    }

    return fallback;
}

function normalizeArtifact(lib, artifact, type, librariesRoot, fallbackRepository) {
    if (!artifact || typeof artifact !== 'object') return null;

    let relativePath = normalizeRelativePath(artifact.path);
    let url = artifact.url || null;

    if (!relativePath && lib?.name) {
        const classifier =
            type === 'native'
                ? null
                : artifact.classifier || null;

        relativePath = normalizeRelativePath(
            mavenCoordinateToPath(
                lib.name,
                classifier,
                artifact.extension || 'jar'
            )
        );
    }

    if (!relativePath) return null;

    const repository = repositoryForLibrary(
        lib?.name,
        fallbackRepository
    );

    if (
        !url ||
        (
            /libraries\.minecraft\.net/i.test(String(url)) &&
            String(lib?.name || '').split(':')[0] &&
            !String(lib.name).startsWith('com.mojang:')
        )
    ) {
        url = `${repository.replace(/\/?$/, '/')}${relativePath}`;
    }

    const destination = resolveInside(
        librariesRoot,
        path.join(librariesRoot, relativePath)
    );

    return {
        type,
        path: relativePath,
        url: String(url),
        sha1: artifact.sha1 || null,
        size: Number.isFinite(Number(artifact.size))
            ? Number(artifact.size)
            : null,
        destination
    };
}

function selectNativeClassifier(lib, classifier) {
    if (!lib?.downloads?.classifiers) return null;

    const candidates = [];
    if (classifier) candidates.push(classifier);

    if (process.platform === 'win32') {
        candidates.push('natives-windows', 'natives-windows-64', 'natives-windows-x86_64');
    } else if (process.platform === 'darwin') {
        candidates.push('natives-osx', 'natives-macos');
    } else {
        candidates.push('natives-linux', 'natives-linux-64');
    }

    for (const key of candidates) {
        if (lib.downloads.classifiers[key]) {
            return {
                classifier: key,
                ...lib.downloads.classifiers[key]
            };
        }
    }

    return null;
}

function sha1File(filePath) {
    const hash = crypto.createHash('sha1');
    const data = fs.readFileSync(filePath);
    return hash.update(data).digest('hex');
}

function copyFromCache(cachePath, destination) {
    try {
        if (!fs.existsSync(cachePath)) return false;

        const stat = fs.statSync(cachePath);
        if (!stat.isFile() || stat.size <= 0) {
            fs.removeSync(cachePath);
            return false;
        }

        fs.ensureDirSync(path.dirname(destination));
        fs.copyFileSync(cachePath, destination);
        return true;
    } catch (_) {
        return false;
    }
}

async function resolveProfileLibraries({
    profile,
    instanceMinecraftDir,
    cacheDir,
    downloadFile,
    sendProgress,
    classifier = null,
    repository = 'https://libraries.minecraft.net/'
}) {
    if (!profile || typeof profile !== 'object') return [];
    if (typeof downloadFile !== 'function') {
        throw new TypeError('libraryManager requiere downloadFile');
    }

    const librariesRoot = path.join(instanceMinecraftDir, 'libraries');
    const nativesRoot = path.join(
        instanceMinecraftDir,
        'versions',
        profile.id || 'loader',
        'natives'
    );

    fs.ensureDirSync(librariesRoot);
    fs.ensureDirSync(nativesRoot);

    const libraries = [];

    for (const lib of profile.libraries || []) {
        if (!lib || typeof lib !== 'object') continue;

        let artifact = normalizeArtifact(
            lib,
            lib.downloads?.artifact,
            'artifact',
            librariesRoot,
            repository
        );

        if (!artifact && lib.name) {
            artifact = normalizeArtifact(
                lib,
                { extension: 'jar' },
                'artifact',
                librariesRoot,
                repository
            );
        }

        if (artifact) {
            libraries.push(artifact);
        }

        const native = selectNativeClassifier(
            lib,
            classifier
        );

        if (native) {
            const nativeArtifact = normalizeArtifact(
                lib,
                native,
                'native',
                librariesRoot,
                repository
            );

            if (nativeArtifact) {
                libraries.push(nativeArtifact);
            }
        }
    }

    if (sendProgress) {
        sendProgress(
            'loader-libraries',
            0,
            libraries.length,
            `Descargando ${libraries.length} librerías del loader...`
        );
    }

    let completed = 0;
    const result = new Array(libraries.length);

    await Promise.all(libraries.map((library, index) => downloadConcurrency(async () => {
        const destination = library.destination;
        const cachePath = path.join(cacheDir, library.path);

        let valid = false;

        if (fs.existsSync(destination)) {
            const stat = fs.statSync(destination);
            valid = stat.isFile() && stat.size > 0;

            if (valid && library.sha1) {
                try {
                    valid = sha1File(destination).toLowerCase() === String(library.sha1).toLowerCase();
                } catch (_) { valid = false; }
            }
        }

        if (!valid) {
            valid = copyFromCache(cachePath, destination);
            if (valid && library.sha1) {
                try {
                    valid = sha1File(destination).toLowerCase() === String(library.sha1).toLowerCase();
                } catch (_) { valid = false; }
            }
        }

        if (!valid) {
            const ok = await downloadFile(library.url, destination, 5);
            if (!ok) throw new Error(`No se pudo descargar la librería ${library.path}`);

            if (library.sha1) {
                const actual = sha1File(destination);
                if (actual.toLowerCase() !== String(library.sha1).toLowerCase()) {
                    await fs.remove(destination);
                    throw new Error(`SHA-1 incorrecto para ${library.path}`);
                }
            }

            fs.ensureDirSync(path.dirname(cachePath));
            fs.copyFileSync(destination, cachePath);
        }

        if (library.type === 'native' && fs.existsSync(destination)) {
            try {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(destination);
                zip.extractAllTo(nativesRoot, true);
            } catch (_) {}
        }

        result[index] = destination;
        completed++;
        if (sendProgress && (completed % 10 === 0 || completed === libraries.length)) {
            sendProgress('loader-libraries', completed, libraries.length, `Librerías del loader: ${completed}/${libraries.length}`);
        }
    })));

    return result;
}

module.exports = {
    normalizeRelativePath,
    mavenCoordinateToPath,
    normalizeArtifact,
    resolveProfileLibraries
};
