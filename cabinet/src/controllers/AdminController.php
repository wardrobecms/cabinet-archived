<?php namespace Wardrobe\Cabinet\Controllers;

use Controller, View, Wardrobe;

class AdminController extends Controller {

	/**
	 * Get the main admin view.
	 */
	public function index()
	{
		return View::make('cabinet::admin.index');
	}

} 
