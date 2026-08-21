// src/minecraft/classpathBuilder.js
const path = require('path');
const fs = require('fs-extra');
const { resolveInside } = require('../core/security');

function normalizePath(value) {
    return path.normalize(value);
}

function isInside(root, target) {
    const rootResolved = path.resolve(root);
    const targetResolved = path.resolve(target);

    return (
        targetResolved === rootResolved ||
        targetResolved.startsWith(rootResolved + path.sep)
    );
}

function addUnique(entries, filePath) {
    const resolved = path.resolve(filePath);

    if (
        !entries.some(
            entry => path.resolve(entry) === resolved
        )
    ) {
        entries.push(resolved);
    }
}

function buildClasspath(
    instanceMinecraftDir,
    minecraftVersion,
    libraries = [],
    options = {}
) {
    if (
        !instanceMinecraftDir ||
        !minecraftVersion
    ) {
        throw new Error(
            'No se puede construir el classpath sin instancia y versión'
        );
    }

    const minecraftRoot = path.resolve(instanceMinecraftDir);
    const librariesRoot = path.join(
        minecraftRoot,
        'libraries'
    );

    fs.ensureDirSync(librariesRoot);

    const entries = [];

    for (const library of libraries) {
        if (!library) continue;

        const candidate =
            typeof library === 'string'
                ? library
                : library.path || library.destination;

        if (!candidate) continue;

        const absolute =
            path.isAbsolute(candidate)
                ? path.resolve(candidate)
                : path.resolve(librariesRoot, candidate);

        if (!isInside(librariesRoot, absolute)) {
            throw new Error(
                `Biblioteca fuera del directorio permitido: ${candidate}`
            );
        }

        if (
            fs.existsSync(absolute) &&
            fs.statSync(absolute).isFile()
        ) {
            addUnique(entries, absolute);
        }
    }

    const versionJar = path.join(
        minecraftRoot,
        'versions',
        minecraftVersion,
        `${minecraftVersion}.jar`
    );

    // NeoForge moderno (1.21+) administra el cliente de Minecraft como módulo
    // propio durante ModuleLayerHandler. Si además ponemos el JAR de Minecraft
    // en el classpath/module-path construido por MineSteam, Java puede resolver
    // dos módulos que exportan el mismo paquete (minecraft y _1._21._1).
    // En ese caso el cliente lo aporta NeoForge y no debemos duplicarlo aquí.
    if (options.includeMinecraftJar !== false) {

    // El cliente debe quedar en el classpath, pero después de las bibliotecas.
    // Verificamos la ruta para evitar path traversal.
    const safeVersionJar = resolveInside(
        minecraftRoot,
        versionJar
    );

    if (
        fs.existsSync(safeVersionJar) &&
        fs.statSync(safeVersionJar).isFile()
    ) {
        addUnique(entries, safeVersionJar);
    }
    }

    if (entries.length === 0) {
        throw new Error(
            'Classpath vacío: no se encontraron librerías ni el JAR de Minecraft'
        );
    }

    return entries.map(normalizePath);
}

module.exports = {
    buildClasspath,
    isInside
};
