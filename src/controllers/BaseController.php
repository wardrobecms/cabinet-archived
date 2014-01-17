<?php namespace Wardrobe\Cabinet\Controllers;

use Controller;

class BaseController extends Controller {

	/**
	 * Create the base controller instance.
	 *
	 * @return BaseController
	 */
	public function __construct()
	{
		$this->beforeFilter('wardrobe_auth');
		$this->beforeFilter('csrf', array('on' => array('post', 'put', 'patch', 'delete')));
	}
}
