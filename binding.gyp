{
  'targets': [{
    'target_name': 'robotjs',
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'xcode_settings': { 'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
        'CLANG_CXX_LIBRARY': 'libc++',
        'MACOSX_DEPLOYMENT_TARGET': '10.15',
      },
      'msvs_settings': {
        'VCCLCompilerTool': { 'ExceptionHandling': 1 },
      },
    'include_dirs': [
      '<!(node -p "require(\'node-addon-api\').include_dir")',
    ],
    
    'conditions': [
      ['OS == "mac"', {
        'include_dirs': [
          '<!(node -p "require(\'node-addon-api\').include_dir")',
          'System/Library/Frameworks/CoreFoundation.Framework/Headers',
          'System/Library/Frameworks/Carbon.Framework/Headers',
          'System/Library/Frameworks/ApplicationServices.framework/Headers',
          'System/Library/Frameworks/OpenGL.framework/Headers',
        ],
        'link_settings': {
          'libraries': [
            '-framework Carbon',
            '-framework CoreFoundation',
            '-framework ApplicationServices',
            '-framework OpenGL'
          ]
        }
      }],
      
      ['OS == "linux"', {
        'link_settings': {
          'libraries': [
            '-lpng',
            '-lz',
            '-lX11',
            '-lXrandr',
            '-lXtst'
          ]
        },
        
        'sources': [
          'src/xdisplay.c'
        ]
      }],

      ["OS=='win'", {
        'defines': ['IS_WINDOWS']
      }]
    ],
    
    'sources': [
      'src/robotjs.cc',
      'src/UTHashTable.c',
      'src/deadbeef_rand.c',
      'src/MMPointArray.c',
      'src/mouse.c',
      'src/keypress.c',
      'src/keycode.c',
      'src/screen.c',
      'src/screengrab.c',
      'src/bitmap_find.c',
      'src/bmp_io.c',
      'src/color_find.c',
      'src/io.c',
      'src/png_io.c',
      'src/snprintf.c',
      'src/MMBitmap.c'
    ]
  }]
}
