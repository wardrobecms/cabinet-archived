<?php namespace Wardrobe\Cabinet;

use Illuminate\Support\Facades\Route;
use Mockery;

abstract class TestCase extends \Orchestra\Testbench\TestCase {

	protected static $wardrobeControllers = 'Wardrobe\\Cabinet\\Controllers\\';

	public function setUp()
	{
		parent::setUp();

		$this->routes();
	}

	protected function tearDown() {
		Mockery::close();
	}

	private function routes()
	{
		Route::get('/', array('uses' => self::$wardrobeControllers.'AdminController@index', 'as' => 'wardrobe.admin.index'));
		Route::get('logout', array('uses' => self::$wardrobeControllers.'LoginController@destroy', 'as' => 'wardrobe.admin.logout'));
		Route::get('login', array('uses' => self::$wardrobeControllers.'LoginController@create', 'as' => 'wardrobe.admin.login'));
		Route::post('login', array('uses' => self::$wardrobeControllers.'LoginController@store'));
		Route::get('login/remind', array('uses' => self::$wardrobeControllers.'LoginController@remindForm', 'as' => 'wardrobe.admin.remindForm'));
		Route::post('login/remind', array('uses' => self::$wardrobeControllers.'LoginController@remindSend'));
	}

}
