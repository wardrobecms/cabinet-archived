<?php namespace Wardrobe\Cabinet\Controllers;

use Controller, View;

class BaseController extends Controller {

	/**
	 * Create the base controller instance.
	 *
	 * @return BaseController
	 */
	public function __construct()
	{
		$this->beforeFilter('wardrobe_auth');
	}
} 
