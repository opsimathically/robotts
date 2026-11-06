{
  'targets': [{
    'target_name': 'robotjs',
    'cflags!': [ '-fno-exceptions' ],
    'cflags_cc!': [ '-fno-exceptions' ],
    'defines': [ 'USE_X11' ],
    'include_dirs': [
      '<!(node -p "require(\'node-addon-api\').include_dir")',
    ],
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
      'src/robotjs.cc',
      'src/hotkey_manager.cc',
      'src/UTHashTable.c',
      'src/deadbeef_rand.c',
      'src/MMPointArray.c',
      'src/mouse.c',
      'src/keypress.c',
      'src/keycode.c',
      'src/screen.c',
      'src/screengrab.c',
      'src/bitmap_find.c',
      'src/bitmap_catalog.cc',
      'src/native_thread_budget.cc',
      'src/bmp_io.c',
      'src/color_find.c',
      'src/io.c',
      'src/png_io.c',
      'src/snprintf.c',
      'src/MMBitmap.c',
      'src/xdisplay.c'
    ]
  }]
}
