import * as mat4 from '@2gis/gl-matrix/mat4';

async function start() {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const gl = ((window as any).gl = canvas.getContext('webgl', { alpha: true }));

    if (!gl) {
        return;
    }

    gl.viewport(0, 0, 300, 300);

    const gltfFile = await fetch('/box.gltf').then((r) => r.json());
    const buffers = await Promise.all(
        gltfFile.buffers.map((buffer) => fetch(buffer.uri).then((r) => r.arrayBuffer())),
    );

    const ctx = {
        gl,
        matrices: [mat4.create()],
        buffers,
        gltf: gltfFile,
    };

    const scene = gltfFile.scenes[gltfFile.scene];
    renderLoop(ctx, scene);
}

function renderLoop(ctx, scene) {
    function step() {
        requestAnimationFrame(step);
        mat4.rotate(ctx.matrices[0], ctx.matrices[0], 0.05, [0.2, 0.3, 0.2]);
        drawNodes(ctx, scene.nodes);
    }
    step();
}

function drawNodes(ctx: any, nodes: number[]) {
    const gl = ctx.gl as WebGLRenderingContext;
    for (const i of nodes) {
        const node = ctx.gltf.nodes[i];
        if (node.matrix && node.children && node.children.length > 0) {
            ctx.matrices.push(node.matrix);
            drawNodes(ctx, node.children);
            ctx.matrices.pop();
        } else if (node.mesh !== undefined) {
            const mesh = ctx.gltf.meshes[node.mesh];
            for (const primitive of mesh.primitives) {
                const attributes = primitive.attributes;
                const program = useMaterial(gl, ctx.gltf.materials[primitive.material]);
                if (!program) {
                    continue;
                }
                let count = 0;
                for (const name in attributes) {
                    const accessor = ctx.gltf.accessors[attributes[name]];
                    const bufferView = ctx.gltf.bufferViews[accessor.bufferView];
                    const buffer = gl.createBuffer();
                    gl.bindBuffer(bufferView.target, buffer);
                    gl.bufferData(
                        bufferView.target,
                        ctx.buffers[bufferView.buffer].slice(
                            bufferView.byteOffset,
                            bufferView.byteOffset + bufferView.byteLength,
                        ),
                        gl.STATIC_DRAW,
                    );
                    const attrLocation = gl.getAttribLocation(program, `a_${name.toLowerCase()}`);
                    if (attrLocation === -1) {
                        continue;
                    }

                    gl.enableVertexAttribArray(attrLocation);
                    gl.vertexAttribPointer(
                        attrLocation,
                        channels(accessor.type),
                        accessor.componentType,
                        true,
                        bufferView.byteStride ?? 0,
                        bufferView.byteOffset + accessor.byteOffset,
                    );
                    count = Math.max(count, accessor.count);
                }

                let elementAccessor = null;
                if (primitive.indices !== undefined) {
                    const accessor = ctx.gltf.accessors[primitive.indices];
                    const bufferView = ctx.gltf.bufferViews[accessor.bufferView];
                    const buffer = gl.createBuffer();
                    elementAccessor = accessor;
                    gl.bindBuffer(bufferView.target, buffer);
                    gl.bufferData(
                        bufferView.target,
                        ctx.buffers[bufferView.buffer].slice(
                            bufferView.byteOffset,
                            bufferView.byteOffset + bufferView.byteLength,
                        ),
                        gl.STATIC_DRAW,
                    );
                }

                const matrixLoc = gl.getUniformLocation(program, 'matrix');

                const mprod = mat4.clone(ctx.matrices[0]);
                for (let i = 1; i < ctx.matrices.length; i++) {
                    mat4.mul(mprod, mprod, ctx.matrices[i]);
                }
                gl.uniformMatrix4fv(matrixLoc, false, mprod);
                if (elementAccessor) {
                    gl.drawElements(
                        primitive.mode,
                        elementAccessor.count,
                        elementAccessor.componentType,
                        0,
                    );
                } else {
                    gl.drawArrays(primitive.mode, 0, count);
                }
            }
        } else {
            console.log(`Cannot draw node ${JSON.stringify(node)}`);
        }
    }
}

function useMaterial(gl: WebGLRenderingContext, material) {
    if (material.pbrMetallicRoughness) {
        const materialConfig = material.pbrMetallicRoughness;
        const VSSRC = `attribute vec4 a_position;
        attribute vec4 a_normal;
        uniform mat4 matrix;
         
        void main() {
          // Multiply the position by the matrix.
          gl_Position = matrix * a_position;
        }`;

        const FSSRC = `precision mediump float;
 
        uniform vec4 color;
         
        void main() {
          gl_FragColor = color * vec4(gl_FragCoord.z, 1., 1., 1.);
        }`;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        if (!vs) {
            return;
        }
        gl.shaderSource(vs, VSSRC);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        if (!fs) {
            return;
        }
        gl.shaderSource(fs, FSSRC);
        gl.compileShader(fs);

        const program = gl.createProgram();
        if (!program) {
            return;
        }
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.useProgram(program);

        const colorLoc = gl.getUniformLocation(program, 'color');
        gl.uniform4fv(colorLoc, materialConfig.baseColorFactor);
        return program;
    }
}

function channels(ats: string) {
    if (ats === 'SCALAR') {
        return 1;
    } else if (ats[0] === 'V') {
        return Number(ats[3]);
    }
    return 0;
}

start();
