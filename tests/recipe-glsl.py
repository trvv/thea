"""Compile and run generated GLSL with a surfaceless GLES context when available."""
import ctypes as c
import json
import os
import sys
os.environ.setdefault('EGL_PLATFORM', 'surfaceless')
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
try:
    egl = c.CDLL('libEGL.so.1')
    gl = c.CDLL('libGLESv2.so.2')
except OSError:
    print('SKIP: EGL/GLES libraries unavailable')
    sys.exit(0)
def api(lib, name, result, *args):
    function = getattr(lib, name)
    function.restype = result
    function.argtypes = args
    return function
ptr, integer, uint = c.c_void_p, c.c_int, c.c_uint
get_display = api(egl, 'eglGetDisplay', ptr, ptr)
initialize = api(egl, 'eglInitialize', uint, ptr, c.POINTER(integer), c.POINTER(integer))
display = get_display(None)
major, minor = integer(), integer()
if not initialize(display, c.byref(major), c.byref(minor)):
    print('SKIP: no surfaceless EGL display')
    sys.exit(0)
api(egl, 'eglBindAPI', uint, uint)(0x30A0)
attributes = (integer * 13)(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3038)
config, count = ptr(), integer()
assert api(egl, 'eglChooseConfig', uint, ptr, c.POINTER(integer), c.POINTER(ptr), integer, c.POINTER(integer))(display, attributes, c.byref(config), 1, c.byref(count)) and count.value
context = api(egl, 'eglCreateContext', ptr, ptr, ptr, ptr, c.POINTER(integer))(display, config, None, (integer * 3)(0x3098, 3, 0x3038))
surface = api(egl, 'eglCreatePbufferSurface', ptr, ptr, ptr, c.POINTER(integer))(display, config, (integer * 5)(0x3057, 64, 0x3056, 1, 0x3038))
assert context and surface
assert api(egl, 'eglMakeCurrent', uint, ptr, ptr, ptr, ptr)(display, surface, surface, context)
create_shader = api(gl, 'glCreateShader', uint, uint)
shader_source = api(gl, 'glShaderSource', None, uint, integer, c.POINTER(c.c_char_p), c.POINTER(integer))
compile_shader = api(gl, 'glCompileShader', None, uint)
shader_status = api(gl, 'glGetShaderiv', None, uint, uint, c.POINTER(integer))
shader_log = api(gl, 'glGetShaderInfoLog', None, uint, integer, c.POINTER(integer), c.c_char_p)
def shader(kind, source):
    identifier = create_shader(kind)
    encoded = c.c_char_p(source.encode())
    shader_source(identifier, 1, c.byref(encoded), None)
    compile_shader(identifier)
    status = integer()
    shader_status(identifier, 0x8B81, c.byref(status))
    if not status.value:
        buffer = c.create_string_buffer(65536)
        shader_log(identifier, len(buffer), None, buffer)
        raise AssertionError(buffer.value.decode() + '\n' + source)
    return identifier
vertex = shader(0x8B31, '''#version 300 es
void main() {
 vec2 p=vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
 gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}''')
create_program = api(gl, 'glCreateProgram', uint)
attach = api(gl, 'glAttachShader', None, uint, uint)
link = api(gl, 'glLinkProgram', None, uint)
program_status = api(gl, 'glGetProgramiv', None, uint, uint, c.POINTER(integer))
program_log = api(gl, 'glGetProgramInfoLog', None, uint, integer, c.POINTER(integer), c.c_char_p)
use = api(gl, 'glUseProgram', None, uint)
viewport = api(gl, 'glViewport', None, integer, integer, integer, integer)
draw = api(gl, 'glDrawArrays', None, uint, integer, integer)
read = api(gl, 'glReadPixels', None, integer, integer, integer, integer, uint, uint, ptr)
with open(sys.argv[1]) as source_file:
    fixtures = json.load(source_file)
for fixture in fixtures:
    fragment = shader(0x8B30, fixture['source'])
    program = create_program()
    attach(program, vertex)
    attach(program, fragment)
    link(program)
    status = integer()
    program_status(program, 0x8B82, c.byref(status))
    if not status.value:
        buffer = c.create_string_buffer(65536)
        program_log(program, len(buffer), None, buffer)
        raise AssertionError(buffer.value.decode())
    use(program)
    viewport(0, 0, 64, 1)
    draw(0x0004, 0, 3)
    pixels = (c.c_ubyte * (64 * 4))()
    read(0, 0, 64, 1, 0x1908, 0x1401, pixels)
    for index, (actual, expected) in enumerate(zip(pixels, fixture['expected'])):
        assert abs(actual - expected) <= 1, (fixture['name'], index, actual, expected)
    api(gl, 'glDeleteProgram', None, uint)(program)
    api(gl, 'glDeleteShader', None, uint)(fragment)
api(egl, 'eglMakeCurrent', uint, ptr, ptr, ptr, ptr)(display, None, None, None)
api(egl, 'eglDestroySurface', uint, ptr, ptr)(display, surface)
api(egl, 'eglDestroyContext', uint, ptr, ptr)(display, context)
api(egl, 'eglTerminate', uint, ptr)(display)
print(f'GLSL checks pass: {len(fixtures)} generated graphs compiled, linked, and matched CPU results in GLES.')
