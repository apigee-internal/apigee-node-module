module.exports = function(grunt) {
  // Project configuration.
  grunt.initConfig({
    //pkg: grunt.file.readJSON('package.json'),
    meta: {
      package: grunt.file.readJSON('package.json'),
      src: {
        main: 'lib',
        test: 'test'
      },
      bin: {
        apigee: 'build/apigee',
        usergrid: 'build/usergrid'
      }
    },
    clean: ['build'],
    //build
    copy: {
      usergrid: {
        files: [
          {
            expand: true,
            cwd: '<%= meta.src.main %>',
            src: ['usergrid.js'],
            dest: '<%= meta.bin.usergrid %>/lib'
          },
          {
            expand: true,
            cwd: 'usergrid',
            src: ['**/*.js', '**/*.json'],
            dest: '<%= meta.bin.usergrid %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['test/*.js', 'test.js'],
            dest: '<%= meta.bin.usergrid %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['README.md'],
            dest: '<%= meta.bin.usergrid %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['LICENSE'],
            dest: '<%= meta.bin.usergrid %>'
          }
        ]
      },
      apigee: {
        files: [
          {
            expand: true,
            cwd: '<%= meta.src.main %>',
            src: ['**/*.js'],
            dest: '<%= meta.bin.apigee %>/lib'
          },
          {
            expand: true,
            cwd: 'apigee',
            src: ['**/*.js', '**/*.json'],
            dest: '<%= meta.bin.apigee %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['LICENSE'],
            dest: '<%= meta.bin.apigee %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['README.md'],
            dest: '<%= meta.bin.apigee %>'
          },
          {
            expand: true,
            cwd: '',
            src: ['test/*.js', 'test.js'],
            dest: '<%= meta.bin.apigee %>'
          }
        ]
      }
    },
    uglify: {
      build: {
        options: {
          banner: '/*! <%= meta.package.name %>@<%= meta.package.version %> <%= grunt.template.today("yyyy-mm-dd") %> */\n',
            mangle: false,
            compress: false,
            beautify: true,
            preserveComments: 'all'
        },
        files: {
          'source/apigee.js': ['<%= meta.bin.main %>/source/usergrid.js','<%= meta.bin.main %>/source/monitoring.js','<%= meta.bin.main %>/source/apigee.js']
        }
      },
      buildmin: {
        options: {
          banner: '/*! <%= meta.package.name %>@<%= meta.package.version %> <%= grunt.template.today("yyyy-mm-dd") %> */\n',
            mangle: false,
            compress: true,
            beautify: false,
            preserveComments: 'some'
        },
        files: {
          'source/apigee.min.js': ['<%= meta.bin.main %>/source/usergrid.js','<%= meta.bin.main %>/source/monitoring.js','<%= meta.bin.main %>/source/apigee.js']
        }
      }
    }
  });
  //build
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-uglify');

  // Default task(s).
  grunt.registerTask('default', ['clean', 'copy', 
    //, 'validate', 'test', 'build'
    //'uglify'
    ]);
};
