<?php namespace Wardrobe\Cabinet\Controllers;

use View;

class AdminController extends BaseController {

	/**
	 * Get the main admin view.
	 */
	public function index()
	{
		return View::make('cabinet::admin.index');
	}

} 
