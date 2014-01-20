<?php namespace Wardrobe\Cabinet\Controllers;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\View;
use Mockery;
use Orchestra\Testbench\TestCase;

class AdminControllerTest extends TestCase {

	public function setUp()
	{
		parent::setUp();

		Route::get('/', array('uses' => 'Wardrobe\\Cabinet\\Controllers\\AdminController@index'));
		Mockery::close();
	}

	public function testIndex()
	{
		View::shouldReceive('make')->once()->with('cabinet::admin.index')->andReturn('admin index!');

		$this->action('GET', 'Wardrobe\\Cabinet\\Controllers\\AdminController@index');
	}
}
 